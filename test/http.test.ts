import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebNotifyHandler } from '../lib/http.ts';

function responseCapture() {
  const result: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const response = {
    writeHead(status: number, headers?: Record<string, string>) {
      result.status = status;
      result.headers = headers;
    },
    end(body?: string) { result.body = body; },
  };
  return { result, response: response as any };
}

test('serves capability, summary, method, and input contracts', async () => {
  const requested: string[] = [];
  const handler = createWebNotifyHandler({
    async get(sessionId) {
      requested.push(sessionId);
      return { ready: true, summary: 'done' };
    },
  });

  let capture = responseCapture();
  await handler({ method: 'GET', url: '/web-notify/capability' } as any, capture.response);
  assert.equal(capture.result.status, 200);
  assert.deepEqual(JSON.parse(capture.result.body ?? ''), { summary: true });
  assert.equal(capture.result.headers?.['cache-control'], 'no-store');

  capture = responseCapture();
  await handler({ method: 'GET', url: '/web-notify/summary?sessionId=session-1' } as any, capture.response);
  assert.equal(capture.result.status, 200);
  assert.deepEqual(JSON.parse(capture.result.body ?? ''), { ready: true, summary: 'done' });
  assert.deepEqual(requested, ['session-1']);

  capture = responseCapture();
  await handler({ method: 'HEAD', url: '/web-notify/capability' } as any, capture.response);
  assert.equal(capture.result.status, 200);
  assert.equal(capture.result.body, undefined);

  capture = responseCapture();
  await handler({ method: 'GET', url: '/web-notify/summary' } as any, capture.response);
  assert.equal(capture.result.status, 400);

  capture = responseCapture();
  await handler({ method: 'POST', url: '/web-notify/summary' } as any, capture.response);
  assert.equal(capture.result.status, 405);
  assert.equal(capture.result.headers?.allow, 'GET, HEAD');
});
