import { defineTool } from '@deepseek-ai/dsh-tools';

import {
  WEB_NOTIFY_META_KIND,
  WEB_NOTIFY_REQUEST_VERSION,
  WEB_NOTIFY_TOOL_NAME,
} from './types.ts';

export function createWebNotifyTool() {
  return defineTool({
    name: WEB_NOTIFY_TOOL_NAME,
    description: 'Send the user one browser notification during the current turn, then continue working. Use it for a meaningful milestone or a concise attention-worthy update during long-running work. Do not use it for routine progress, final completion, or a pending approval/question because Web Notify already handles those automatically. The notification must make sense without the surrounding transcript.',
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'One concise, standalone, user-facing sentence describing the meaningful update.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requestId: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: () => [{
        type: 'text',
        text: 'Browser notification requested. Continue the current turn.',
      }],
      presentationMeta: (_args, value) => ({
        kind: WEB_NOTIFY_META_KIND,
        version: WEB_NOTIFY_REQUEST_VERSION,
        requestId: value.requestId,
        message: value.message,
      }),
    },
    async execute(args, exec) {
      if (exec.agent === undefined) {
        throw new Error('web notification requires an owning agent session');
      }
      if (exec.agent.session.header.origin === 'subagent') {
        throw new Error('web notifications are available only to user-facing sessions');
      }
      const message = args.message.trim();
      if (message.length === 0) throw new Error('notification message must not be empty');
      return {
        requestId: String(exec.callId),
        message,
      };
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Notify user',
      kind: 'other',
      rawInput: args,
    }),
  });
}
