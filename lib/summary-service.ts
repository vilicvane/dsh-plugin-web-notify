import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';

import type { Settings } from './config.ts';
import { buildSummaryPrompt, extractLatestCompletedTurn } from './turn-summary.ts';

export type SummaryResponse =
  | { ready: true; summary: string }
  | { ready: false; continuing: true }
  | { ready: false; error?: string };

interface SummaryEntry {
  status: 'ready' | 'failed';
  text?: string;
  error?: string;
}

const MAX_CACHED_SUMMARIES = 200;
const MAX_SUMMARY_CHARS = 300;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TurnSummaryService {
  private readonly cache = new Map<string, SummaryEntry>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private disposed = false;
  private readonly ctx: Context;
  private readonly settings: Settings;

  constructor(ctx: Context, settings: Settings) {
    this.ctx = ctx;
    this.settings = settings;
  }

  async get(sessionIdText: string): Promise<SummaryResponse> {
    if (this.disposed) return { ready: false };
    let sessionId: ReturnType<typeof SessionId>;
    try {
      sessionId = SessionId(sessionIdText);
    } catch {
      return { ready: false };
    }
    const session = this.ctx.sessions.get(sessionId);
    if (session === undefined) return { ready: false };

    const turn = extractLatestCompletedTurn(session.events, this.settings.maxInputChars);
    if (turn === undefined) return { ready: false };
    if (turn.continues) return { ready: false, continuing: true };
    if (turn.userText === '' && turn.assistantText === '') return { ready: false };
    const key = `${sessionId}:${turn.sourceSeq}`;
    const existing = this.cache.get(key);
    if (existing !== undefined) return this.response(existing);

    let inFlight = this.inFlight.get(key);
    if (inFlight === undefined) {
      inFlight = this.summarize(key, sessionId, buildSummaryPrompt(turn));
      this.inFlight.set(key, inFlight);
    }
    try {
      await inFlight;
    } finally {
      if (this.inFlight.get(key) === inFlight) this.inFlight.delete(key);
    }
    const completed = this.cache.get(key);
    return completed === undefined ? { ready: false } : this.response(completed);
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private response(entry: SummaryEntry): SummaryResponse {
    return entry.status === 'ready'
      ? { ready: true, summary: entry.text ?? '' }
      : { ready: false, ...(entry.error === undefined ? {} : { error: entry.error }) };
  }

  private async summarize(
    key: string,
    sessionId: ReturnType<typeof SessionId>,
    prompt: string,
  ): Promise<void> {
    try {
      const text = (await this.runModelCall(prompt, sessionId)).trim().slice(0, MAX_SUMMARY_CHARS);
      if (text === '') throw new Error('summary model produced no text');
      this.put(key, { status: 'ready', text });
    } catch (error) {
      const message = errorText(error);
      this.ctx.logger.warn(`web-notify: failed to summarize session "${sessionId}": ${message}`);
      this.put(key, { status: 'failed', error: message });
    }
  }

  private put(key: string, entry: SummaryEntry): void {
    if (!this.cache.has(key) && this.cache.size >= MAX_CACHED_SUMMARIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, entry);
  }

  private async runModelCall(
    prompt: string,
    sessionId: ReturnType<typeof SessionId>,
  ): Promise<string> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    let text = '';
    try {
      for await (const chunk of this.ctx.llm.stream({
        provider: this.settings.provider,
        model: this.settings.model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: {
            kind: 'plugin',
            plugin: 'web-notify',
            form: 'notice',
            summary: 'Summarize the completed work segment for a browser notification',
          },
        })],
        system: this.settings.systemPrompt,
        maxTokens: this.settings.maxOutputTokens,
        sessionId,
        purpose: 'session-title',
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') {
          text += chunk.text;
        } else if (chunk.type === 'finish'
          && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          throw new Error(`summary model stream finished with reason "${chunk.reason.kind}"`);
        }
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
    return text;
  }
}
