/**
 * Web notification plugin, host half.
 *
 * Serves short one-sentence summaries of finished turns through the
 * `/web-notify/summary` HTTP route registered with the DSH web server. Turn
 * content is read on demand from the in-memory session store (`ctx.sessions`)
 * — no event subscription — and summarized by a small model via
 * `ctx.llm.stream`. The browser half never needs API keys or direct model
 * access.
 *
 * Model route and limits are configurable through the profile patch row:
 *
 *   - id: web-notify
 *     name: dsh-plugin-web-notify
 *     config:
 *       provider: deepseek-official
 *       model: deepseek-chat
 */

const name = 'web-notify';

const inject = ['llm', 'webServer', 'sessions'];

const DEFAULT_PROVIDER = 'deepseek-official';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_MAX_INPUT_CHARS = 4_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 150;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_SYSTEM_PROMPT =
  'You write short summaries of finished coding-agent conversation turns ' +
  'for desktop notifications. Reply with exactly one concise sentence (at ' +
  'most 30 words) describing what was accomplished in this turn. Answer in ' +
  'the same language as the user input. No preamble, no markdown.';

const SUMMARY_PATH = '/web-notify/summary';
const CAPABILITY_PATH = '/web-notify/capability';
const MAX_TRACKED_SESSIONS = 200;

function apply(ctx, config) {
  const settings = resolveSettings(config);

  /** sessionId -> {sourceSeq, text} for the summarized turn. */
  const summaryMap = new Map();

  /** sessionId -> in-flight summarization promise (request dedupe). */
  const inFlightMap = new Map();

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/web-notify',
        handler: handleSummaryRequest,
      }),
    'web-notify: summary route',
  );

  async function handleSummaryRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === CAPABILITY_PATH) {
      res.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({summary: true}));
      return;
    }

    if (url.pathname !== SUMMARY_PATH) {
      res.writeHead(404);
      res.end();
      return;
    }

    const sessionId = url.searchParams.get('sessionId') ?? '';
    const result = await getSummary(sessionId);

    res.writeHead(200, {'content-type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(result));
  }

  async function getSummary(sessionId) {
    const session = ctx.sessions.get(sessionId);

    if (session === undefined) {
      return {ready: false};
    }

    const {userText, assistantText, sourceSeq} = extractTurnText(
      session.events,
      settings.maxInputChars,
    );

    if (userText === '' && assistantText === '') {
      return {ready: false};
    }

    const existing = summaryMap.get(sessionId);

    if (existing !== undefined && existing.sourceSeq === sourceSeq) {
      return existing.status === 'failed'
        ? {ready: false, error: existing.error}
        : {ready: true, summary: existing.text};
    }

    const inFlight = inFlightMap.get(sessionId);

    if (inFlight !== undefined) {
      await inFlight.catch(() => undefined);
    } else {
      const promise = summarize(sessionId, sourceSeq, userText, assistantText);
      inFlightMap.set(sessionId, promise);

      try {
        await promise;
      } finally {
        inFlightMap.delete(sessionId);
      }
    }

    const summary = summaryMap.get(sessionId);

    if (summary !== undefined && summary.sourceSeq === sourceSeq) {
      return summary.status === 'failed'
        ? {ready: false, error: summary.error}
        : {ready: true, summary: summary.text};
    }

    return {ready: false};
  }

  async function summarize(sessionId, sourceSeq, userText, assistantText) {
    const prompt = buildSummaryPrompt(userText, assistantText);

    try {
      const text = await runModelCall(prompt, sessionId);
      const trimmed = text.trim().slice(0, 300);

      if (trimmed.length === 0) {
        throw new Error('web-notify: summary model produced no text');
      }

      if (summaryMap.size >= MAX_TRACKED_SESSIONS) {
        const oldestKey = summaryMap.keys().next().value;

        if (oldestKey !== undefined) {
          summaryMap.delete(oldestKey);
        }
      }

      summaryMap.set(sessionId, {sourceSeq, status: 'ready', text: trimmed});
    } catch (error) {
      ctx.logger.warn(`web-notify: failed to summarize session "${sessionId}"`);
      ctx.logger.warn(error);
      summaryMap.set(sessionId, {
        sourceSeq,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function runModelCall(prompt, sessionId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
    let text = '';

    try {
      for await (const chunk of ctx.llm.stream({
        provider: settings.provider,
        model: settings.model,
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: [{type: 'text', text: prompt}],
            source: {kind: 'plugin', plugin: 'dsh-plugin-web-notify'},
          },
        ],
        system: settings.systemPrompt,
        maxTokens: settings.maxOutputTokens,
        sessionId,
        // The DeepSeek adapter disables model thinking for this purpose, so
        // the small token budget goes to the summary text instead of being
        // consumed by reasoning.
        purpose: 'session-title',
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta') {
          text += chunk.text;
        } else if (
          chunk.type === 'finish' &&
          (chunk.reason === 'error' || chunk.reason === 'aborted')
        ) {
          throw new Error(
            `web-notify: summary model stream finished with reason "${chunk.reason}"`,
          );
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    return text;
  }
}

function resolveSettings(config) {
  const source =
    config !== null && typeof config === 'object' ? config : {};

  return {
    provider:
      typeof source.provider === 'string' && source.provider !== ''
        ? source.provider
        : DEFAULT_PROVIDER,
    model:
      typeof source.model === 'string' && source.model !== ''
        ? source.model
        : DEFAULT_MODEL,
    maxInputChars:
      typeof source.maxInputChars === 'number' && source.maxInputChars > 0
        ? source.maxInputChars
        : DEFAULT_MAX_INPUT_CHARS,
    maxOutputTokens:
      typeof source.maxOutputTokens === 'number' &&
      source.maxOutputTokens > 0
        ? source.maxOutputTokens
        : DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs:
      typeof source.timeoutMs === 'number' && source.timeoutMs > 0
        ? source.timeoutMs
        : DEFAULT_TIMEOUT_MS,
    systemPrompt:
      typeof source.systemPrompt === 'string' && source.systemPrompt !== ''
        ? source.systemPrompt
        : DEFAULT_SYSTEM_PROMPT,
  };
}

/**
 * Extract the text of the last user message and the last assistant message
 * from the session log. `sourceSeq` is the seq of the assistant message (the
 * summary's content identity): a newer assistant message invalidates a cached
 * summary.
 */
function extractTurnText(events, maxInputChars) {
  let userText = '';
  let assistantText = '';
  let sourceSeq = -1;

  for (const event of events) {
    if (event.type === 'user/message') {
      // `user/message` data is the UserMessage itself.
      userText = extractText(event.data?.content);
    } else if (event.type === 'assistant/message') {
      // `assistant/message` data is {turn, step, message, usage}: the
      // message (and its content blocks) live under `data.message`.
      assistantText = extractText(event.data?.message?.content);
      sourceSeq = event.seq;
    }
  }

  return {
    userText: capText(userText, maxInputChars),
    assistantText: capText(assistantText, maxInputChars),
    sourceSeq,
  };
}

function buildSummaryPrompt(userText, assistantText) {
  const parts = [];

  if (userText !== '') {
    parts.push(`用户请求:\n${userText}`);
  }

  if (assistantText !== '') {
    parts.push(`助手回复:\n${assistantText}`);
  }

  return parts.join('\n\n');
}

function extractText(content) {
  if (!Array.isArray(content)) {
    return '';
  }

  let text = '';

  for (const block of content) {
    if (
      block !== null &&
      typeof block === 'object' &&
      block.type === 'text' &&
      typeof block.text === 'string'
    ) {
      text += `${block.text}\n`;
    }
  }

  return text.trim();
}

function capText(text, maxChars) {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

export {apply, inject, name};
