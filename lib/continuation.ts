import type { ToolResultMessage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';

export const TURN_MEMORY_CONTINUATION_KIND = 'turn-memory-continuation';
export const TURN_MEMORY_PLUGIN = 'turn-memory';
export const TURN_MEMORY_CONTINUATION_PHASE = 'continuation';
export const TURN_CONTINUATION_TOOL_NAME = 'continue_after_turn_compression';

export interface TurnContinuationSource {
  requestId: string;
  fromTurn: number;
}

function isTurnMemoryContinuationSource(source: Record<string, unknown>): boolean {
  if (source.kind === TURN_MEMORY_CONTINUATION_KIND) return true;

  // DSH 0.1.x sessions recorded the continuation under the shared `plugin` source kind.
  return source.kind === 'plugin'
    && source.plugin === TURN_MEMORY_PLUGIN
    && source.phase === TURN_MEMORY_CONTINUATION_PHASE;
}

export function continuationSourceFromEvent(
  event: SessionEvent,
): TurnContinuationSource | undefined {
  if (event.type !== 'user/message') return undefined;
  const source = event.data.source as Record<string, unknown>;
  const requestId = source.requestId;
  const fromTurn = source.fromTurn;
  if (!isTurnMemoryContinuationSource(source)
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

function toolResultFailed(message: ToolResultMessage): boolean {
  if (message.isError === true) return true;

  // DSH 0.1.x kept the outcome inside the `tool-result` content block instead.
  const block: unknown = message.content[0];
  return block !== null
    && typeof block === 'object'
    && (block as { isError?: unknown }).isError === true;
}

export function successfulToolResultCallId(event: SessionEvent): string | undefined {
  if (event.type !== 'tool/result') return undefined;
  return toolResultFailed(event.data.message)
    ? undefined
    : event.data.message.source.callId;
}

export function successfulCodeContinuationId(event: SessionEvent): string | undefined {
  // DSH 0.1.5 renamed the PTC dispatch event (`tool/code-dispatch` ->
  // `tool/ptc-dispatch`) without changing its data shape.
  if (event.type !== 'tool/ptc-dispatch') return undefined;
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
