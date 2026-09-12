import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
  installWebNotifications,
  stringsForLanguage,
} from '../client/index.ts';
import type { BrowserBindings, WebNotifyClientContext } from '../client/index.ts';

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function clientHarness(fetchResults: unknown[], initialSnapshot?: any) {
  let snapshot: any = initialSnapshot ?? {
    byId: {
      'session-1': {
        id: 'session-1',
        displayTitle: 'Notify work',
        running: true,
        blank: false,
        updatedAt: 1,
      },
    },
    current: undefined,
  };
  const subscribers = new Set<() => void>();
  const pendingSubscribers = new Set<() => void>();
  let pendingSnapshot = new Map<string, { key: string; kind: string; sessionId: string }>();
  const timers = new Map<number, () => void>();
  const notifications: Array<{ title: string; body?: string; notification: any }> = [];
  const opened: string[] = [];
  let timerId = 0;
  let fetchCalls = 0;

  class FakeNotification {
    static permission = 'granted';
    static async requestPermission() { return 'granted'; }
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      notifications.push({ title, body: options?.body, notification: this });
    }
    close() {}
  }

  const window = {
    focus() {},
    addEventListener() {},
    removeEventListener() {},
    setTimeout(callback: () => void) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(id: number) { timers.delete(id); },
  } as unknown as Window;
  const browser: BrowserBindings = {
    window,
    document: { hasFocus: () => false } as unknown as Document,
    notification: FakeNotification as unknown as typeof Notification,
    audioContext: undefined,
    language: 'en-US',
    fetch: (async () => {
      const value = fetchResults[fetchCalls];
      fetchCalls += 1;
      return { ok: true, async json() { return value; } } as Response;
    }) as typeof fetch,
  };
  const ctx = {
    uiSession: {
      pendingInteractions: {
        getSnapshot: () => pendingSnapshot,
        subscribe(callback: () => void) {
          pendingSubscribers.add(callback);
          return () => pendingSubscribers.delete(callback);
        },
      },
    },
    sessions: {
      list: {
        getSnapshot: () => snapshot,
        subscribe(callback: () => void) {
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        },
      },
      open(id: string) { opened.push(id); },
    },
    on() { return () => {}; },
  } as unknown as WebNotifyClientContext;

  return {
    browser,
    ctx,
    notifications,
    opened,
    get fetchCalls() { return fetchCalls; },
    updatePending(kind?: string, key = kind) {
      pendingSnapshot = kind === undefined ? new Map() : new Map([
        ['session-1', { key: key!, kind, sessionId: 'session-1' }],
      ]);
      for (const callback of pendingSubscribers) callback();
    },
    update(value: any) {
      snapshot = value;
      for (const callback of subscribers) callback();
    },
    runNextTimer() {
      const entry = timers.entries().next().value as [number, () => void] | undefined;
      assert.ok(entry, 'expected a scheduled timer');
      timers.delete(entry[0]);
      entry[1]();
    },
  };
}

test('localizes notification copy', () => {
  assert.equal(stringsForLanguage('zh-CN').completed, '对话已完成');
  assert.equal(stringsForLanguage('en-US').pending.question, 'A question is waiting for your answer');
});

test('notifies for independent UI requests and replacements of the same kind', async () => {
  const harness = clientHarness([{ summary: false }]);
  const dispose = installWebNotifications(harness.ctx, harness.browser);
  await flush();
  harness.updatePending('question', 'first-question');
  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0].body, 'A question is waiting for your answer');
  harness.updatePending('question', 'first-question');
  assert.equal(harness.notifications.length, 1);
  harness.updatePending('question', 'second-question');
  assert.equal(harness.notifications.length, 2);
  harness.updatePending('plan-review', 'plan');
  assert.equal(harness.notifications.at(-1)?.body, 'A plan is waiting for your review');
  dispose();
  harness.updatePending('approval', 'after-dispose');
  assert.equal(harness.notifications.length, 3);
});

test('upgrades a completion notification with the host summary', async () => {
  const harness = clientHarness([
    { summary: true },
    { ready: true, summary: 'The refactor passed all checks.' },
  ]);
  const dispose = installWebNotifications(harness.ctx, harness.browser, {
    summaryPollIntervalMs: 1,
  });
  await flush();
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 2,
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'Conversation finished · summarizing…');
  harness.runNextTimer();
  await flush();
  assert.equal(harness.notifications.at(-1)?.body, 'The refactor passed all checks.');
  harness.notifications.at(-1)?.notification.onclick();
  assert.deepEqual(harness.opened, ['session-1']);
  dispose();
});

test('suppresses an intermediate continued turn and notifies after the final turn', async () => {
  const harness = clientHarness([{ summary: false }]);
  const dispose = installWebNotifications(harness.ctx, harness.browser);
  await flush();
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 2,
        projectionValues: {
          webNotifyCompletion: { version: 1, turn: 1, endSeq: 10, continues: true },
        },
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.length, 0);

  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: true, blank: false, updatedAt: 3,
        projectionValues: {
          webNotifyCompletion: { version: 1, turn: 1, endSeq: 10, continues: true },
        },
      },
    },
    current: undefined,
  });
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 4,
        projectionValues: {
          webNotifyCompletion: { version: 1, turn: 2, endSeq: 20, continues: false },
        },
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0].body, 'Conversation finished');
  dispose();
});

test('a new pending interaction invalidates an older summary poll', async () => {
  const harness = clientHarness([
    { summary: true },
    { ready: true, summary: 'This stale summary must not appear.' },
  ]);
  const dispose = installWebNotifications(harness.ctx, harness.browser, {
    summaryPollIntervalMs: 1,
  });
  await flush();
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 2,
      },
    },
    current: undefined,
  });
  harness.updatePending('approval');
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 3,
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'An approval request is waiting for you');
  harness.runNextTimer();
  await flush();
  assert.equal(harness.notifications.at(-1)?.body, 'An approval request is waiting for you');
  assert.equal(harness.fetchCalls, 1, 'invalidated timer must not request a stale summary');
  dispose();
});

test('shows a new agent-requested notification but never replays the initial projection', async () => {
  const initialSnapshot = {
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: true, blank: false, updatedAt: 1,
        projectionValues: {
          webNotifyRequest: { version: 1, requestId: 'old', message: 'Old update' },
        },
      },
    },
    current: undefined,
  };
  const harness = clientHarness([{ summary: false }], initialSnapshot);
  const dispose = installWebNotifications(harness.ctx, harness.browser);
  await flush();
  assert.equal(harness.notifications.length, 0);

  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: true, blank: false, updatedAt: 2,
        projectionValues: {
          webNotifyRequest: { version: 1, requestId: 'new', message: 'The build passed.' },
        },
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'The build passed.');
  dispose();
});

test('pending interaction wins when it arrives with an agent-requested notification', async () => {
  const harness = clientHarness([{ summary: false }]);
  const dispose = installWebNotifications(harness.ctx, harness.browser);
  await flush();
  harness.updatePending('approval');
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: true, blank: false, updatedAt: 2,
        projectionValues: {
          webNotifyRequest: { version: 1, requestId: 'new', message: 'Lower priority update' },
        },
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'An approval request is waiting for you');

  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: true, blank: false, updatedAt: 3,
        projectionValues: {
          webNotifyRequest: { version: 1, requestId: 'new', message: 'Lower priority update' },
        },
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.length, 1, 'consumed lower-priority request must not replay');
  dispose();
});

test('agent-requested notification invalidates an in-flight completion summary', async () => {
  const harness = clientHarness([
    { summary: true },
    { ready: true, summary: 'This stale summary must not appear.' },
  ]);
  const dispose = installWebNotifications(harness.ctx, harness.browser, {
    summaryPollIntervalMs: 1,
  });
  await flush();
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 2,
      },
    },
    current: undefined,
  });
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 3,
        projectionValues: {
          webNotifyRequest: { version: 1, requestId: 'new', message: 'A later update.' },
        },
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'A later update.');
  harness.runNextTimer();
  await flush();
  assert.equal(harness.notifications.at(-1)?.body, 'A later update.');
  assert.equal(harness.fetchCalls, 1, 'invalidated timer must not request a stale summary');
  dispose();
});

test('an unresolved or changed pending interaction stays above completion', async () => {
  const harness = clientHarness([{ summary: false }]);
  const dispose = installWebNotifications(harness.ctx, harness.browser);
  await flush();
  harness.updatePending('approval');
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: true, blank: false, updatedAt: 2,
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'An approval request is waiting for you');
  const afterApproval = harness.notifications.length;

  harness.updatePending('approval');
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 3,
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.length, afterApproval);
  assert.equal(harness.notifications.at(-1)?.body, 'An approval request is waiting for you');

  harness.updatePending('question');
  harness.update({
    byId: {
      'session-1': {
        id: 'session-1', displayTitle: 'Notify work', running: false, blank: false, updatedAt: 4,
      },
    },
    current: undefined,
  });
  assert.equal(harness.notifications.at(-1)?.body, 'A question is waiting for your answer');
  dispose();
});

test('generated browser bundle exposes the typed client plugin', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  let loaded: any;
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(value: any) { loaded = value; },
      },
    },
  });
  assert.equal(loaded.id, 'dsh-plugin-web-notify');
  const exports = loaded.factory();
  assert.equal(exports.name, 'web-notify');
  assert.deepEqual(Array.from(exports.inject), ['sessions', 'uiSession']);
  assert.equal(typeof exports.apply, 'function');
});
