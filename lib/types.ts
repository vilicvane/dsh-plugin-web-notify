export const WEB_NOTIFY_META_KIND = 'dsh-plugin-web-notify/request';
export const WEB_NOTIFY_REQUEST_VERSION = 1;
export const WEB_NOTIFY_TOOL_NAME = 'web_notify__send';
export const WEB_NOTIFY_COMPLETION_VERSION = 1;

export interface WebNotifyRequest {
  version: 1;
  requestId: string;
  message: string;
}

export interface WebNotifyMeta extends WebNotifyRequest {
  kind: typeof WEB_NOTIFY_META_KIND;
}

export interface WebNotifyCompletion {
  version: 1;
  turn: number;
  endSeq: number;
  continues: boolean;
}

export interface WebNotifyCompletionState {
  currentTurn: number | null;
  continuationCallIds: string[];
  continuationSucceeded: boolean;
  latest: WebNotifyCompletion | null;
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    webNotifyRequest: WebNotifyRequest | null;
    webNotifyCompletion: WebNotifyCompletionState;
  }

  interface SessionProjectionMap {
    webNotifyRequest: WebNotifyRequest | null;
    webNotifyCompletion: WebNotifyCompletion | null;
  }
}
