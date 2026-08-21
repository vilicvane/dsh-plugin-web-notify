import assert from 'node:assert/strict';
import test from 'node:test';

import { Context } from '@deepseek-ai/cordis';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import LlmRuntime, {
  CallId,
  LlmAdapter,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

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
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime, { mode: 'native' });
    await ctx.plugin(SessionProjectionRegistry);
    const adapter = new SummaryAdapter();
    ctx.llm.registerAdapter(['web-notify-test'], adapter);
    await ctx.plugin(webNotifyPlugin, {
      provider: 'web-notify-test',
      model: 'summary-model',
      timeoutMs: 5_000,
    });
    assert.ok(ctx.tools.schemas().some((tool) => tool.name === 'web_notify__send'));

    const session = ctx.sessions.create(SessionId('session-web-notify-cordis'));
    const notifyCallId = CallId('notify-call-cordis');
    const notifyTool = ctx.tools.get('web_notify__send');
    assert.ok(notifyTool);
    const notifyArgs = { message: 'The integration smoke reached its midpoint.' };
    const notifyValue = await notifyTool.execute(notifyArgs, {
      callId: notifyCallId,
      agent: { session },
    } as any) as any;
    const notifyContent = notifyTool.output.render(notifyArgs, notifyValue);
    const notifyMeta = notifyTool.output.presentationMeta?.(notifyArgs, notifyValue);
    session.append('turn/start', { turn: 0 });
    session.append('step/start', { turn: 0, step: 0 });
    session.append('tool/call', {
      turn: 0,
      step: 0,
      callId: notifyCallId,
      name: 'web_notify__send',
      arguments: JSON.stringify(notifyArgs),
    });
    session.append('tool/result', {
      turn: 0,
      step: 0,
      message: createToolResultMessage({
        callId: notifyCallId,
        content: notifyContent,
        isError: false,
      }),
      meta: notifyMeta,
    }, { surfaceOp: 'append' });
    session.append('step/end', { turn: 0, step: 0 });
    session.append('turn/end', { turn: 0, reason: { kind: 'completed' } });
    assert.deepEqual(ctx.sessionProjections.snapshot(session).values.webNotifyRequest, {
      version: 1,
      requestId: 'notify-call-cordis',
      message: 'The integration smoke reached its midpoint.',
    });

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
