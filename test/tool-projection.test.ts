import assert from 'node:assert/strict';
import test from 'node:test';

import { CallId } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { Session, SessionId } from '@deepseek-ai/dsh-session';

import {
  webNotifyCompletionProjection,
  webNotifyProjection,
  webNotifyRequestFromEvent,
} from '../lib/projection.ts';
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

test('completion projection marks only successful continuation handoffs', () => {
  const projection = webNotifyCompletionProjection();
  let state = projection.init();
  const apply = (seq: number, type: string, data: unknown): void => {
    state = projection.apply(state, { seq, time: seq, type, data } as SessionEvent);
  };

  apply(0, 'turn/start', { turn: 1 });
  apply(1, 'tool/call', {
    turn: 1,
    step: 1,
    callId: 'continue-native',
    name: 'continue_after_turn_compression',
    arguments: JSON.stringify({ handoff: 'next' }),
  });
  apply(2, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'result-native',
      role: 'user',
      source: { kind: 'tool', callId: 'continue-native' },
      content: [{
        type: 'tool-result',
        toolCallId: 'continue-native',
        content: [{ type: 'text', text: 'queued' }],
        isError: false,
      }],
    },
  });
  apply(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
  assert.deepEqual(projection.wire?.view(state), {
    version: 1,
    turn: 1,
    endSeq: 3,
    continues: true,
  });

  apply(4, 'turn/start', { turn: 2 });
  apply(5, 'tool/code-dispatch', {
    subCallId: 'continue-code',
    name: 'continue_after_turn_compression',
    arguments: { handoff: 'next' },
    isError: true,
  });
  apply(6, 'turn/end', { turn: 2, reason: { kind: 'completed' } });
  assert.deepEqual(projection.wire?.view(state), {
    version: 1,
    turn: 2,
    endSeq: 6,
    continues: false,
  });
});
