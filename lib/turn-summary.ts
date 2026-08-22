import type { SessionEvent } from '@deepseek-ai/dsh-session';

import {
  continuationSourceFromEvent,
  intervalHasSuccessfulContinuation,
  successfulContinuationIds,
} from './continuation.ts';

export interface CompletedTurnText {
  turn: number;
  turns: number[];
  sourceSeq: number;
  continues: boolean;
  userText: string;
  assistantText: string;
}

interface CompletedTurnInterval {
  turn: number;
  startIndex: number;
  endIndex: number;
}

export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block !== null
      && typeof block === 'object'
      && (block as any).type === 'text'
      && typeof (block as any).text === 'string') {
      const text = (block as any).text.trim();
      if (text !== '') parts.push(text);
    }
  }
  return parts.join('\n');
}

export function capText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function intervalEndingAt(
  events: readonly SessionEvent[],
  endIndex: number,
): CompletedTurnInterval | undefined {
  const end = events[endIndex];
  if (end?.type !== 'turn/end') return undefined;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'turn/start' && event.data.turn === end.data.turn) {
      return { turn: end.data.turn, startIndex: index, endIndex };
    }
  }
  return undefined;
}

function previousInterval(
  events: readonly SessionEvent[],
  turn: number,
  beforeIndex: number,
): CompletedTurnInterval | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'turn/end' || event.data.turn !== turn) continue;
    return intervalEndingAt(events, index);
  }
  return undefined;
}

function continuationLink(
  events: readonly SessionEvent[],
  interval: CompletedTurnInterval,
): ReturnType<typeof continuationSourceFromEvent> {
  const links = events
    .slice(interval.startIndex + 1, interval.endIndex)
    .map(continuationSourceFromEvent)
    .filter((value) => value !== undefined);
  return links.length === 1 ? links[0] : undefined;
}

/**
 * Extract the latest completed logical work segment. A Turn Memory automatic
 * continuation links its turn to the successfully handed-off predecessor, so
 * several physical turns become one notification summary source. Ordinary
 * earlier turns, open later turns, and plugin/runtime user text stay excluded.
 * sourceSeq remains the final closing turn/end identity used by the cache.
 */
export function extractLatestCompletedTurn(
  events: readonly SessionEvent[],
  maxInputChars: number,
): CompletedTurnText | undefined {
  let endIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'turn/end') {
      endIndex = index;
      break;
    }
  }
  if (endIndex < 0) return undefined;

  const latest = intervalEndingAt(events, endIndex);
  if (latest === undefined) return undefined;
  const intervals = [latest];
  const seenEnds = new Set([latest.endIndex]);
  let current = latest;
  while (true) {
    const link = continuationLink(events, current);
    if (link === undefined) break;
    const previous = previousInterval(events, link.fromTurn, current.startIndex);
    if (previous === undefined
      || seenEnds.has(previous.endIndex)
      || !intervalHasSuccessfulContinuation(
        events,
        previous.startIndex,
        previous.endIndex,
        link.requestId,
      )) {
      break;
    }
    intervals.unshift(previous);
    seenEnds.add(previous.endIndex);
    current = previous;
  }

  const userParts: string[] = [];
  const assistantParts: string[] = [];
  for (const interval of intervals) {
    for (let index = interval.startIndex + 1; index < interval.endIndex; index += 1) {
      const event = events[index];
      if (event.type === 'user/message' && event.data.source.kind === 'user') {
        const text = extractText(event.data.content);
        if (text !== '') userParts.push(text);
        continue;
      }
      if (event.type === 'assistant/message' && event.data.turn === interval.turn) {
        const text = extractText(event.data.message.content);
        if (text !== '') assistantParts.push(text);
      }
    }
  }

  return {
    turn: latest.turn,
    turns: intervals.map((interval) => interval.turn),
    sourceSeq: events[endIndex].seq,
    continues: successfulContinuationIds(
      events,
      latest.startIndex,
      latest.endIndex,
    ).size > 0,
    userText: capText(userParts.join('\n\n'), maxInputChars),
    assistantText: capText(assistantParts.join('\n\n'), maxInputChars),
  };
}

export function buildSummaryPrompt(turn: CompletedTurnText): string {
  const parts: string[] = [];
  if (turn.userText !== '') {
    parts.push(`<human-input>\n${turn.userText}\n</human-input>`);
  }
  if (turn.assistantText !== '') {
    parts.push(`<assistant-output>\n${turn.assistantText}\n</assistant-output>`);
  }
  return parts.join('\n\n');
}
