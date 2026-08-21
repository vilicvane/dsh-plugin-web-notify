export const WEB_NOTIFY_META_KIND = 'dsh-plugin-web-notify/request';
export const WEB_NOTIFY_REQUEST_VERSION = 1;
export const WEB_NOTIFY_TOOL_NAME = 'web_notify__send';

export interface WebNotifyRequest {
  version: 1;
  requestId: string;
  message: string;
}

export interface WebNotifyMeta extends WebNotifyRequest {
  kind: typeof WEB_NOTIFY_META_KIND;
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    webNotifyRequest: WebNotifyRequest | null;
  }
}
