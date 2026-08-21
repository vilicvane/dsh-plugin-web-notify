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
    sourceSeq: 11,
    userText: 'Initial requirement\n\nCorrection from the user',
    assistantText: 'Mapped the implementation.\n\nFinished and verified the change.',
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
    sourceSeq: 8,
    userText: '修复通知',
    assistantText: '已完成并通过测试',
  });
  assert.match(prompt, /<human-input>\n修复通知\n<\/human-input>/);
  assert.match(prompt, /<assistant-output>\n已完成并通过测试\n<\/assistant-output>/);
  assert.doesNotMatch(prompt, /用户请求|助手回复/);
});
