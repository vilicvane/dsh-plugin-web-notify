import type { SessionEvent } from '@deepseek-ai/dsh-session';

export interface CompletedTurnText {
  turn: number;
  sourceSeq: number;
  userText: string;
  assistantText: string;
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

/**
 * Extract human input and assistant-visible text from the latest completed
 * turn. Open later turns and plugin/runtime user messages are deliberately
 * excluded; sourceSeq is the closing turn/end identity used by the cache.
 */
export function extractLatestCompletedTurn(
  events: readonly SessionEvent[],
  maxInputChars: number,
): CompletedTurnText | undefined {
  let endIndex = -1;
  let turn = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'turn/end') {
      endIndex = index;
      turn = event.data.turn;
      break;
    }
  }
  if (endIndex < 0) return undefined;

  let startIndex = -1;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === 'turn/start' && event.data.turn === turn) {
      startIndex = index;
      break;
    }
  }
  if (startIndex < 0) return undefined;

  const userParts: string[] = [];
  const assistantParts: string[] = [];
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const event = events[index];
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      const text = extractText(event.data.content);
      if (text !== '') userParts.push(text);
      continue;
    }
    if (event.type === 'assistant/message' && event.data.turn === turn) {
      const text = extractText(event.data.message.content);
      if (text !== '') assistantParts.push(text);
    }
  }

  return {
    turn,
    sourceSeq: events[endIndex].seq,
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
