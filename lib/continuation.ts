import type { SessionEvent } from '@deepseek-ai/dsh-session';

export const TURN_MEMORY_PLUGIN = 'turn-memory';
export const TURN_MEMORY_CONTINUATION_PHASE = 'continuation';
export const TURN_CONTINUATION_TOOL_NAME = 'continue_after_turn_compression';

export interface TurnContinuationSource {
  requestId: string;
  fromTurn: number;
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function continuationSourceFromEvent(
  event: SessionEvent,
): TurnContinuationSource | undefined {
  if (event.type !== 'user/message') return undefined;
  const source = event.data.source as Record<string, unknown>;
  const requestId = source.requestId;
  const fromTurn = source.fromTurn;
  if (source.kind !== 'plugin'
    || source.plugin !== TURN_MEMORY_PLUGIN
    || source.phase !== TURN_MEMORY_CONTINUATION_PHASE
    || typeof requestId !== 'string'
    || requestId.length === 0
    || typeof fromTurn !== 'number'
    || !Number.isSafeInteger(fromTurn)) {
    return undefined;
  }
  return { requestId, fromTurn };
}

export function nativeContinuationCallId(event: SessionEvent): string | undefined {
  return event.type === 'tool/call'
    && event.data.name === TURN_CONTINUATION_TOOL_NAME
    && typeof event.data.callId === 'string'
    ? event.data.callId
    : undefined;
}

export function successfulToolResultCallId(event: SessionEvent): string | undefined {
  if (event.type !== 'tool/result'
    || event.data.message.source.kind !== 'tool'
    || typeof event.data.message.source.callId !== 'string') {
    return undefined;
  }
  const block = event.data.message.content.find((candidate: unknown) =>
    isRecord(candidate) && candidate.type === 'tool-result');
  return isRecord(block) && block.isError !== true
    ? event.data.message.source.callId
    : undefined;
}

export function successfulCodeContinuationId(event: SessionEvent): string | undefined {
  if (event.type !== 'tool/code-dispatch') return undefined;
  const data = event.data;
  return data.name === TURN_CONTINUATION_TOOL_NAME
    && data.isError === false
    && typeof data.subCallId === 'string'
    ? data.subCallId
    : undefined;
}

export function successfulContinuationIds(
  events: readonly SessionEvent[],
  startIndex: number,
  endIndex: number,
): Set<string> {
  const calls = new Set<string>();
  const successful = new Set<string>();
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const event = events[index];
    const codeId = successfulCodeContinuationId(event);
    if (codeId !== undefined) successful.add(codeId);
    const callId = nativeContinuationCallId(event);
    if (callId !== undefined) calls.add(callId);
    const resultId = successfulToolResultCallId(event);
    if (resultId !== undefined && calls.has(resultId)) successful.add(resultId);
  }
  return successful;
}

export function intervalHasSuccessfulContinuation(
  events: readonly SessionEvent[],
  startIndex: number,
  endIndex: number,
  requestId: string,
): boolean {
  return successfulContinuationIds(events, startIndex, endIndex).has(requestId);
}
