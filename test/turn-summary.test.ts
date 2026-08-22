import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionEvent } from '@deepseek-ai/dsh-session';

import {
  buildSummaryPrompt,
  capText,
  extractLatestCompletedTurn,
} from '../lib/turn-summary.ts';

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as SessionEvent;
}

function user(seq: number, text: string, source: unknown = { kind: 'user' }): SessionEvent {
  return event(seq, 'user/message', {
    id: `u-${seq}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  });
}

function assistant(seq: number, turn: number, text: string): SessionEvent {
  return event(seq, 'assistant/message', {
    turn,
    step: seq,
    message: {
      id: `a-${seq}`,
      role: 'assistant',
      content: text === '' ? [] : [{ type: 'text', text }],
      source: { kind: 'model', provider: 'p', model: 'm' },
    },
  });
}

test('extracts only the latest completed turn and keeps its interaction order', () => {
  const events = [
    event(0, 'turn/start', { turn: 1 }),
    user(1, 'Old request'),
    assistant(2, 1, 'Old result'),
    event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(4, 'turn/start', { turn: 2 }),
    user(5, 'Initial requirement'),
    user(6, 'Runtime snapshot', {
      kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: [],
    }),
    assistant(7, 2, 'Mapped the implementation.'),
    user(8, 'Correction from the user'),
    assistant(9, 2, ''),
    assistant(10, 2, 'Finished and verified the change.'),
    event(11, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    event(12, 'turn/start', { turn: 3 }),
    user(13, 'A newer open turn must not leak in'),
  ];

  assert.deepEqual(extractLatestCompletedTurn(events, 10_000), {
    turn: 2,
    turns: [2],
    sourceSeq: 11,
    continues: false,
    userText: 'Initial requirement\n\nCorrection from the user',
    assistantText: 'Mapped the implementation.\n\nFinished and verified the change.',
  });
});

test('merges only a verified Turn Memory continuation chain', () => {
  const continuation = (seq: number, fromTurn: number, requestId: string): SessionEvent =>
    user(seq, `automatic continuation from ${fromTurn}`, {
      kind: 'plugin',
      plugin: 'turn-memory',
      phase: 'continuation',
      requestId,
      fromTurn,
    });
  const call = (seq: number, turn: number, callId: string): SessionEvent => event(seq, 'tool/call', {
    turn,
    step: 1,
    callId,
    name: 'continue_after_turn_compression',
    arguments: JSON.stringify({ handoff: 'continue' }),
  });
  const result = (seq: number, turn: number, callId: string): SessionEvent => event(seq, 'tool/result', {
    turn,
    step: 1,
    message: {
      id: `result-${callId}`,
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'queued' }],
        isError: false,
      }],
    },
  });
  const events = [
    event(0, 'turn/start', { turn: 0 }),
    user(1, 'Unrelated earlier task'),
    assistant(2, 0, 'Unrelated earlier result'),
    event(3, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
    event(4, 'turn/start', { turn: 1 }),
    user(5, 'Implement the notifier chain'),
    assistant(6, 1, 'Implemented the host half.'),
    call(7, 1, 'continue-1'),
    result(8, 1, 'continue-1'),
    event(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(10, 'turn/start', { turn: 2 }),
    continuation(11, 1, 'continue-1'),
    assistant(12, 2, 'Implemented the browser half.'),
    event(13, 'tool/code-dispatch', {
      subCallId: 'continue-2',
      name: 'continue_after_turn_compression',
      arguments: { handoff: 'verify' },
      isError: false,
    }),
    event(14, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
  ];

  assert.deepEqual(extractLatestCompletedTurn(events, 10_000), {
    turn: 2,
    turns: [1, 2],
    sourceSeq: 14,
    continues: true,
    userText: 'Implement the notifier chain',
    assistantText: 'Implemented the host half.\n\nImplemented the browser half.',
  });

  events.push(
    event(15, 'turn/start', { turn: 3 }),
    continuation(16, 2, 'continue-2'),
    assistant(17, 3, 'Verified the complete feature.'),
    event(18, 'turn/end', { turn: 3, reason: { kind: 'completed' } }),
  );
  assert.deepEqual(extractLatestCompletedTurn(events, 10_000), {
    turn: 3,
    turns: [1, 2, 3],
    sourceSeq: 18,
    continues: false,
    userText: 'Implement the notifier chain',
    assistantText: [
      'Implemented the host half.',
      'Implemented the browser half.',
      'Verified the complete feature.',
    ].join('\n\n'),
  });
});

test('does not merge an unverified continuation source into earlier work', () => {
  const events = [
    event(0, 'turn/start', { turn: 1 }),
    user(1, 'Earlier unrelated request'),
    assistant(2, 1, 'Earlier unrelated result'),
    event(3, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(4, 'turn/start', { turn: 2 }),
    user(5, 'Unverified continuation metadata', {
      kind: 'plugin',
      plugin: 'turn-memory',
      phase: 'continuation',
      requestId: 'missing-successful-request',
      fromTurn: 1,
    }),
    assistant(6, 2, 'Only this result belongs to the summary.'),
    event(7, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
  ];

  assert.deepEqual(extractLatestCompletedTurn(events, 10_000), {
    turn: 2,
    turns: [2],
    sourceSeq: 7,
    continues: false,
    userText: '',
    assistantText: 'Only this result belongs to the summary.',
  });
});

test('returns no turn for an incomplete or structurally broken log', () => {
  assert.equal(extractLatestCompletedTurn([
    event(0, 'turn/start', { turn: 1 }),
    user(1, 'Still running'),
  ], 100), undefined);
  assert.equal(extractLatestCompletedTurn([
    event(0, 'turn/end', { turn: 4, reason: { kind: 'completed' } }),
  ], 100), undefined);
});

test('caps recent causal text and renders language-neutral prompt boundaries', () => {
  assert.equal(capText('abcdefgh', 5), 'defgh');
  const prompt = buildSummaryPrompt({
    turn: 1,
    turns: [1],
    sourceSeq: 8,
    continues: false,
    userText: '修复通知',
    assistantText: '已完成并通过测试',
  });
  assert.match(prompt, /<human-input>\n修复通知\n<\/human-input>/);
  assert.match(prompt, /<assistant-output>\n已完成并通过测试\n<\/assistant-output>/);
  assert.doesNotMatch(prompt, /用户请求|助手回复/);
});
