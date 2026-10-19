import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionEvent } from '@deepseek-ai/dsh-session';

import {
  continuationSourceFromEvent,
  successfulToolResultCallId,
  TURN_MEMORY_CONTINUATION_KIND,
} from '../lib/continuation.ts';

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent;
}

function user(seq: number, source: unknown): SessionEvent {
  return event(seq, 'user/message', {
    id: `u-${seq}`,
    role: 'user',
    content: [{ type: 'text', text: 'automatic continuation' }],
    source,
  });
}

test('recognizes both the per-producer continuation source kind and the legacy plugin one', () => {
  assert.deepEqual(continuationSourceFromEvent(user(1, {
    kind: TURN_MEMORY_CONTINUATION_KIND,
    form: 'notice',
    summary: 'Continue work after compressing turn 2',
    requestId: 'req-1',
    fromTurn: 2,
  })), { requestId: 'req-1', fromTurn: 2 });

  assert.deepEqual(continuationSourceFromEvent(user(2, {
    kind: 'plugin',
    plugin: 'turn-memory',
    phase: 'continuation',
    requestId: 'req-2',
    fromTurn: 3,
  })), { requestId: 'req-2', fromTurn: 3 });

  assert.equal(continuationSourceFromEvent(user(3, { kind: 'user' })), undefined);
});

test('reads the tool outcome from the message in 0.2.1 and from the block in 0.1.x', () => {
  const result = (message: unknown): SessionEvent => event(1, 'tool/result', {
    turn: 1,
    step: 1,
    message,
  });

  assert.equal(successfulToolResultCallId(result({
    id: 'result-1',
    role: 'tool',
    toolCallId: 'call-1',
    source: { kind: 'tool', callId: 'call-1' },
    content: [{ type: 'text', text: 'queued' }],
    isError: false,
  })), 'call-1');

  assert.equal(successfulToolResultCallId(result({
    id: 'result-1',
    role: 'tool',
    toolCallId: 'call-1',
    source: { kind: 'tool', callId: 'call-1' },
    content: [{ type: 'text', text: 'queued' }],
    isError: true,
  })), undefined);

  assert.equal(successfulToolResultCallId(result({
    id: 'result-1',
    role: 'user',
    source: { kind: 'tool', callId: 'call-1' },
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'queued' }],
      isError: false,
    }],
  })), 'call-1');

  assert.equal(successfulToolResultCallId(result({
    id: 'result-1',
    role: 'user',
    source: { kind: 'tool', callId: 'call-1' },
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'queued' }],
      isError: true,
    }],
  })), undefined);
});
