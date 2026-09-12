import assert from 'node:assert/strict';
import test from 'node:test';

import type { Context } from '@deepseek-ai/cordis';

import { resolveSettings } from '../lib/config.ts';
import { TurnSummaryService } from '../lib/summary-service.ts';

function events(): any[] {
  return [
    { seq: 0, time: 0, type: 'turn/start', data: { turn: 1 } },
    {
      seq: 1,
      time: 1,
      type: 'user/message',
      data: {
        id: 'u1', role: 'user', content: [{ type: 'text', text: 'Refactor notifications' }], source: { kind: 'user' },
      },
    },
    {
      seq: 2,
      time: 2,
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Implemented and tested it.' }],
          source: { kind: 'model', provider: 'p', model: 'm' },
        },
      },
    },
    { seq: 3, time: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ];
}

test('deduplicates concurrent model calls and caches one completed turn', async () => {
  let calls = 0;
  let request: any;
  const ctx = {
    sessions: { get: () => ({ snapshotEvents: () => events() }) },
    llm: {
      async *stream(options: any) {
        calls += 1;
        request = options;
        yield { type: 'text-delta', text: 'Notifications were refactored ' };
        yield { type: 'text-delta', text: 'and verified.' };
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    },
    logger: { warn() {} },
  } as unknown as Context;
  const service = new TurnSummaryService(ctx, resolveSettings());

  const [first, second] = await Promise.all([
    service.get('session-summary-test'),
    service.get('session-summary-test'),
  ]);
  assert.deepEqual(first, { ready: true, summary: 'Notifications were refactored and verified.' });
  assert.deepEqual(second, first);
  assert.deepEqual(await service.get('session-summary-test'), first);
  assert.equal(calls, 1);
  assert.equal(request.purpose, 'session-title');
  assert.equal(request.messages[0].source.plugin, 'web-notify');
  assert.match(request.messages[0].content[0].text, /<human-input>/);
  service.dispose();
});

test('caches model failures for the same completed turn', async () => {
  let calls = 0;
  const warnings: string[] = [];
  const ctx = {
    sessions: { get: () => ({ snapshotEvents: () => events() }) },
    llm: {
      async *stream() {
        calls += 1;
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'offline' } } };
      },
    },
    logger: { warn(value: string) { warnings.push(value); } },
  } as unknown as Context;
  const service = new TurnSummaryService(ctx, resolveSettings());
  const first = await service.get('session-summary-failure');
  const second = await service.get('session-summary-failure');

  assert.deepEqual(first, { ready: false, error: 'summary model stream finished with reason "error"' });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.match(warnings[0], /failed to summarize session/);
  service.dispose();
});

test('does not summarize a turn that successfully requested continuation', async () => {
  let calls = 0;
  const continuedEvents = events();
  continuedEvents.splice(3, 0,
    {
      seq: 3,
      time: 3,
      type: 'tool/call',
      data: {
        turn: 1,
        step: 1,
        callId: 'continue-1',
        name: 'continue_after_turn_compression',
        arguments: JSON.stringify({ handoff: 'next' }),
      },
    },
    {
      seq: 4,
      time: 4,
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'continue-result',
          role: 'user',
          source: { kind: 'tool', callId: 'continue-1' },
          content: [{
            type: 'tool-result',
            toolCallId: 'continue-1',
            content: [{ type: 'text', text: 'queued' }],
            isError: false,
          }],
        },
      },
    },
  );
  continuedEvents.at(-1)!.seq = 5;
  continuedEvents.at(-1)!.time = 5;
  const ctx = {
    sessions: { get: () => ({ snapshotEvents: () => continuedEvents }) },
    llm: {
      async *stream() {
        calls += 1;
        yield { type: 'text-delta', text: 'must not run' };
      },
    },
    logger: { warn() {} },
  } as unknown as Context;
  const service = new TurnSummaryService(ctx, resolveSettings());

  assert.deepEqual(await service.get('session-summary-continuing'), {
    ready: false,
    continuing: true,
  });
  assert.equal(calls, 0);
  service.dispose();
});
