import assert from 'node:assert/strict';
import test from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import LlmRuntime, {
  LlmAdapter,
  createAssistantMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';

import * as webNotifyPlugin from '../index.ts';

class SummaryAdapter extends LlmAdapter {
  calls: any[] = [];

  async *stream(options: any) {
    this.calls.push(options);
    yield { type: 'text-delta', index: 0, text: 'The notification refactor passed its integration smoke.' } as const;
    yield { type: 'finish', reason: { kind: 'stop' } } as const;
  }
}

test('serves a real completed-turn summary through Cordis and HTTP', async () => {
  const ctx = new Context();
  try {
    await ctx.plugin(SessionStore);
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 });
    const adapter = new SummaryAdapter();
    ctx.llm.registerAdapter(['web-notify-test'], adapter);
    await ctx.plugin(webNotifyPlugin, {
      provider: 'web-notify-test',
      model: 'summary-model',
      timeoutMs: 5_000,
    });

    const session = ctx.sessions.create(SessionId('session-web-notify-cordis'));
    session.append('turn/start', { turn: 1 });
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Refactor the notifier.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' });
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Implemented TypeScript and tests.' }],
        source: { provider: 'web-notify-test', model: 'summary-model' },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [] });
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });

    const base = `http://127.0.0.1:${ctx.webServer.port}`;
    const capability = await fetch(`${base}/web-notify/capability`, {
      signal: AbortSignal.timeout(3_000),
    });
    assert.deepEqual(await capability.json(), { summary: true });

    const response = await fetch(
      `${base}/web-notify/summary?sessionId=${encodeURIComponent(session.id)}`,
      { signal: AbortSignal.timeout(3_000) },
    );
    assert.deepEqual(await response.json(), {
      ready: true,
      summary: 'The notification refactor passed its integration smoke.',
    });
    assert.equal(adapter.calls.length, 1);
    assert.equal(adapter.calls[0].purpose, 'session-title');
    assert.match(adapter.calls[0].messages[0].content[0].text, /Refactor the notifier/);
    assert.match(adapter.calls[0].messages[0].content[0].text, /Implemented TypeScript and tests/);
  } finally {
    await ctx.fiber.dispose();
  }
});
