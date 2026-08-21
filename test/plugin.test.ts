import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, inject, name } from '../index.ts';

test('registers one disposable host route with typed defaults', () => {
  let route: any;
  let routeDisposed = false;
  let effectDisposed: (() => void) | undefined;
  const ctx = {
    sessions: { get() { return undefined; } },
    llm: { stream() { throw new Error('not called'); } },
    logger: { warn() {} },
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
  assert.deepEqual(inject, ['llm', 'webServer', 'sessions']);
  assert.equal(route.kind, 'prefix');
  assert.equal(route.path, '/web-notify');
  assert.equal(typeof route.handler, 'function');
  effectDisposed?.();
  assert.equal(routeDisposed, true);
});
