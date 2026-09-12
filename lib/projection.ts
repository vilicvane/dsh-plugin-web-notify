import { z } from 'zod';

import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';

import {
  WEB_NOTIFY_META_KIND,
  WEB_NOTIFY_COMPLETION_VERSION,
  WEB_NOTIFY_REQUEST_VERSION,
  WEB_NOTIFY_TOOL_NAME,
} from './types.ts';
import type {
  WebNotifyCompletion,
  WebNotifyCompletionState,
  WebNotifyMeta,
  WebNotifyRequest,
} from './types.ts';
import {
  nativeContinuationCallId,
  successfulCodeContinuationId,
  successfulToolResultCallId,
} from './continuation.ts';

export const webNotifyRequestSchema = z.union([
  z.object({
    version: z.literal(WEB_NOTIFY_REQUEST_VERSION),
    requestId: z.string().min(1),
    message: z.string().min(1),
  }),
  z.null(),
]);

export const webNotifyCompletionSchema = z.union([
  z.object({
    version: z.literal(WEB_NOTIFY_COMPLETION_VERSION),
    turn: z.number().int().nonnegative(),
    endSeq: z.number().int().nonnegative(),
    continues: z.boolean(),
  }),
  z.null(),
]);

export const webNotifyCompletionStateSchema = z.object({
  currentTurn: z.number().int().nonnegative().nullable(),
  continuationCallIds: z.array(z.string().min(1)),
  continuationSucceeded: z.boolean(),
  latest: webNotifyCompletionSchema,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requestFromMeta(value: unknown): WebNotifyRequest | undefined {
  if (!isRecord(value)
    || value.kind !== WEB_NOTIFY_META_KIND
    || value.version !== WEB_NOTIFY_REQUEST_VERSION
    || typeof value.requestId !== 'string'
    || value.requestId.length === 0
    || typeof value.message !== 'string'
    || value.message.length === 0) {
    return undefined;
  }
  const meta = value as unknown as WebNotifyMeta;
  return {
    version: WEB_NOTIFY_REQUEST_VERSION,
    requestId: meta.requestId,
    message: meta.message,
  };
}

/** Extract a successful notification request from Native or Code Mode tool events. */
export function webNotifyRequestFromEvent(event: SessionEvent): WebNotifyRequest | undefined {
  if (event.type === 'tool/result') return requestFromMeta(event.data.meta);

  // `tool/ptc-dispatch` is contributed to SessionEventMap by dsh-tools. DSH
  // 0.1.5 renamed it from `tool/code-dispatch` with the same data shape, so the
  // structural field checks below still hold.
  if (event.type !== 'tool/ptc-dispatch') return undefined;
  const data = event.data;
  if (data.name !== WEB_NOTIFY_TOOL_NAME || data.isError || !isRecord(data.arguments)) {
    return undefined;
  }
  const message = data.arguments.message;
  if (typeof message !== 'string' || message.trim().length === 0) return undefined;
  return {
    version: WEB_NOTIFY_REQUEST_VERSION,
    requestId: String(data.subCallId),
    message: message.trim(),
  };
}

export function webNotifyProjection(): ProjectionDefinition<
  'webNotifyRequest',
  WebNotifyRequest | null
> {
  return {
    key: 'webNotifyRequest',
    stateSchema: webNotifyRequestSchema,
    init: () => null,
    apply(state, event) {
      const request = webNotifyRequestFromEvent(event);
      if (request === undefined || request.requestId === state?.requestId) return state;
      return request;
    },
    wire: {
      viewSchema: webNotifyRequestSchema,
      view: (state) => state,
    },
    stateVersion: 1,
  };
}

export function webNotifyCompletionProjection(): ProjectionDefinition<
  'webNotifyCompletion',
  WebNotifyCompletionState
> {
  return {
    key: 'webNotifyCompletion',
    stateSchema: webNotifyCompletionStateSchema,
    init: () => ({
      currentTurn: null,
      continuationCallIds: [],
      continuationSucceeded: false,
      latest: null,
    }),
    apply(state, event) {
      if (event.type === 'turn/start') {
        return {
          currentTurn: event.data.turn,
          continuationCallIds: [],
          continuationSucceeded: false,
          latest: state.latest,
        };
      }
      if (state.currentTurn === null) return state;

      const nativeCallId = nativeContinuationCallId(event);
      if (nativeCallId !== undefined && !state.continuationCallIds.includes(nativeCallId)) {
        return {
          ...state,
          continuationCallIds: [...state.continuationCallIds, nativeCallId],
        };
      }
      const resultId = successfulToolResultCallId(event);
      if (resultId !== undefined
        && state.continuationCallIds.includes(resultId)
        && !state.continuationSucceeded) {
        return { ...state, continuationSucceeded: true };
      }
      if (successfulCodeContinuationId(event) !== undefined && !state.continuationSucceeded) {
        return { ...state, continuationSucceeded: true };
      }
      if (event.type !== 'turn/end' || event.data.turn !== state.currentTurn) return state;

      const latest: WebNotifyCompletion = {
        version: WEB_NOTIFY_COMPLETION_VERSION,
        turn: event.data.turn,
        endSeq: event.seq,
        continues: state.continuationSucceeded,
      };
      return {
        currentTurn: null,
        continuationCallIds: [],
        continuationSucceeded: false,
        latest,
      };
    },
    wire: {
      viewSchema: webNotifyCompletionSchema,
      view: (state) => state.latest,
    },
    stateVersion: 1,
  };
}
