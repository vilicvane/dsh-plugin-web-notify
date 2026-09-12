import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, inject, name } from '../index.ts';

test('registers one disposable host route with typed defaults', () => {
  let route: any;
  let routeDisposed = false;
  let effectDisposed: (() => void) | undefined;
  const projections: any[] = [];
  const tools: any[] = [];
  const ctx = {
    sessions: { get() { return undefined; } },
    llm: { stream() { throw new Error('not called'); } },
    logger: { warn() {} },
    sessionProjections: { register(value: any) { projections.push(value); } },
    tools: { register(value: any) { tools.push(value); } },
    webServer: {
      register(value: any) {
        route = value;
        return () => { routeDisposed = true; };
      },
    },
    effect(callback: () => () => void) { effectDisposed = callback(); },
  };

  apply(ctx as any, {});
  assert.equal(name, 'web-notify');
  assert.deepEqual(inject, ['llm', 'webServer', 'connection', 'sessions', 'sessionProjections', 'tools']);
  assert.deepEqual(projections.map((value) => value.key), [
    'webNotifyRequest',
    'webNotifyCompletion',
  ]);
  assert.deepEqual(tools.map((value) => value.name), ['web_notify__send']);
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/web-notify');
  assert.equal(typeof route.handler, 'function');
  effectDisposed?.();
  assert.equal(routeDisposed, true);
});
