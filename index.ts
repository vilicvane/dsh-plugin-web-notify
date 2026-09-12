import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-tools';

import { resolveSettings } from './lib/config.ts';
import type { Config } from './lib/config.ts';
import { createWebNotifyHandler } from './lib/http.ts';
import {
  webNotifyCompletionProjection,
  webNotifyProjection,
} from './lib/projection.ts';
import { TurnSummaryService } from './lib/summary-service.ts';
import { createWebNotifyTool } from './lib/tool.ts';

const name = 'web-notify';
const inject = ['llm', 'webServer', 'connection', 'sessions', 'sessionProjections', 'tools'];

function apply(ctx: Context, config: Config = {}): void {
  const projections = ctx.sessionProjections as unknown as {
    register(definition: ReturnType<typeof webNotifyProjection>): () => void;
    register(definition: ReturnType<typeof webNotifyCompletionProjection>): () => void;
  };
  projections.register(webNotifyProjection());
  projections.register(webNotifyCompletionProjection());
  ctx.tools.register(createWebNotifyTool());

  const service = new TurnSummaryService(ctx, resolveSettings(config));
  const handler = createWebNotifyHandler(service);
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: '/web-notify',
      handler: (req, res) => {
        const rejection = ctx.connection.requestRejection(req);
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'cache-control': 'no-store' });
          res.end();
          return;
        }
        return handler(req, res);
      },
    });
    return () => {
      service.dispose();
      disposeRoute();
    };
  }, 'web-notify: summary route');
}

export { apply, inject, name };
export type { Config } from './lib/config.ts';
export type { WebNotifyRequest } from './lib/types.ts';
