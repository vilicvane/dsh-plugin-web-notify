import { z } from 'zod';

import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';

import {
  WEB_NOTIFY_META_KIND,
  WEB_NOTIFY_REQUEST_VERSION,
  WEB_NOTIFY_TOOL_NAME,
} from './types.ts';
import type { WebNotifyMeta, WebNotifyRequest } from './types.ts';

export const webNotifyRequestSchema = z.union([
  z.object({
    version: z.literal(WEB_NOTIFY_REQUEST_VERSION),
    requestId: z.string().min(1),
    message: z.string().min(1),
  }),
  z.null(),
]);

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

  // `tool/code-dispatch` is contributed to SessionEventMap by dsh-tools. Keep
  // this structural so the projection remains tolerant of older stored rows.
  if (event.type !== 'tool/code-dispatch') return undefined;
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
    schema: webNotifyRequestSchema,
    init: () => null,
    apply(state, event) {
      const request = webNotifyRequestFromEvent(event);
      if (request === undefined || request.requestId === state?.requestId) return state;
      return request;
    },
    view: (state) => state,
    stateVersion: 1,
  };
}
