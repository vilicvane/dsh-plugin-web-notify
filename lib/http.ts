import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SummaryResponse } from './summary-service.ts';

export const SUMMARY_PATH = '/web-notify/summary';
export const CAPABILITY_PATH = '/web-notify/capability';

export interface SummaryReader {
  get(sessionId: string): Promise<SummaryResponse>;
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
}

export function createWebNotifyHandler(reader: SummaryReader) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === CAPABILITY_PATH) {
      sendJson(req, res, 200, { summary: true });
      return;
    }
    if (url.pathname !== SUMMARY_PATH) {
      res.writeHead(404);
      res.end();
      return;
    }
    const sessionId = url.searchParams.get('sessionId');
    if (sessionId === null || sessionId === '') {
      sendJson(req, res, 400, { ready: false, error: 'sessionId is required' });
      return;
    }
    sendJson(req, res, 200, await reader.get(sessionId));
  };
}
