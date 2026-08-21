import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session';

import { resolveSettings } from './lib/config.ts';
import type { Config } from './lib/config.ts';
import { createWebNotifyHandler } from './lib/http.ts';
import { TurnSummaryService } from './lib/summary-service.ts';

const name = 'web-notify';
const inject = ['llm', 'webServer', 'sessions'];

function apply(ctx: Context, config: Config = {}): void {
  const service = new TurnSummaryService(ctx, resolveSettings(config));
  const handler = createWebNotifyHandler(service);
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: '/web-notify',
      handler,
    });
    return () => {
      service.dispose();
      disposeRoute();
    };
  }, 'web-notify: summary route');
}

export { apply, inject, name };
export type { Config } from './lib/config.ts';
