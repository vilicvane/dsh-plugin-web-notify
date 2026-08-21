import assert from 'node:assert/strict';
import test from 'node:test';

import { CallId } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { Session, SessionId } from '@deepseek-ai/dsh-session';

import { webNotifyProjection, webNotifyRequestFromEvent } from '../lib/projection.ts';
import { createWebNotifyTool } from '../lib/tool.ts';
import { WEB_NOTIFY_META_KIND, WEB_NOTIFY_TOOL_NAME } from '../lib/types.ts';

function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 1, data } as SessionEvent;
}

test('tool returns a durable presentation envelope without ending the turn', async () => {
  const session = Session.create(SessionId('session-web-notify-tool'));
  const tool = createWebNotifyTool();
  const eventCountBefore = session.events.length;
  const value = await tool.execute({ message: '  The first phase passed.  ' }, {
    callId: CallId('notify-call-1'),
    agent: { session },
  } as any) as { requestId: string; message: string };

  assert.equal(tool.name, WEB_NOTIFY_TOOL_NAME);
  assert.deepEqual(value, {
    requestId: 'notify-call-1',
    message: 'The first phase passed.',
  });
  assert.deepEqual(tool.output.presentationMeta?.({ message: value.message }, value), {
    kind: WEB_NOTIFY_META_KIND,
    version: 1,
    requestId: 'notify-call-1',
    message: 'The first phase passed.',
  });
  assert.deepEqual(tool.output.render({}, value), [{
    type: 'text',
    text: 'Browser notification requested. Continue the current turn.',
  }]);
  assert.equal(
    session.events.length,
    eventCountBefore,
    'the tool body must not append a private event',
  );
});

test('tool rejects empty messages, detached calls, and subagent sessions', async () => {
  const tool = createWebNotifyTool();
  await assert.rejects(
    tool.execute({ message: ' ' }, { callId: CallId('empty'), agent: {
      session: Session.create(SessionId('empty-message')),
    } } as any),
    /must not be empty/,
  );
  await assert.rejects(
    tool.execute({ message: 'Update' }, { callId: CallId('detached') } as any),
    /owning agent session/,
  );
  await assert.rejects(
    tool.execute({ message: 'Update' }, {
      callId: CallId('subagent'),
      agent: { session: { header: { origin: 'subagent' } } },
    } as any),
    /user-facing sessions/,
  );
});

test('projection folds Native meta and successful Code Mode dispatches', () => {
  const projection = webNotifyProjection();
  const nativeEvent = event('tool/result', {
    meta: {
      kind: WEB_NOTIFY_META_KIND,
      version: 1,
      requestId: 'native-1',
      message: 'Native milestone reached.',
    },
  });
  const nativeRequest = webNotifyRequestFromEvent(nativeEvent);
  assert.deepEqual(nativeRequest, {
    version: 1,
    requestId: 'native-1',
    message: 'Native milestone reached.',
  });

  const nativeState = projection.apply(projection.init(), nativeEvent);
  assert.equal(projection.apply(nativeState, nativeEvent), nativeState, 'same request is idempotent');

  const codeEvent = event('tool/code-dispatch', {
    rootCallId: 'run-code-1',
    parentCallId: 'run-code-1',
    subCallId: 'run-code-1:code:0',
    name: WEB_NOTIFY_TOOL_NAME,
    arguments: { message: '  Code Mode milestone reached.  ' },
    isError: false,
    content: [],
  });
  assert.deepEqual(projection.apply(nativeState, codeEvent), {
    version: 1,
    requestId: 'run-code-1:code:0',
    message: 'Code Mode milestone reached.',
  });

  assert.equal(webNotifyRequestFromEvent(event('tool/code-dispatch', {
    subCallId: 'failed',
    name: WEB_NOTIFY_TOOL_NAME,
    arguments: { message: 'Do not show' },
    isError: true,
  })), undefined);
});
