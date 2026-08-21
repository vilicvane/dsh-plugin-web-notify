import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_SYSTEM_PROMPT, resolveSettings } from '../lib/config.ts';

test('resolves stable defaults and explicit summary settings', () => {
  assert.deepEqual(resolveSettings(), {
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    maxInputChars: 4_000,
    maxOutputTokens: 150,
    timeoutMs: 60_000,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
  assert.deepEqual(resolveSettings({
    provider: ' local-provider ',
    model: ' small-model ',
    maxInputChars: 9_000,
    maxOutputTokens: 90,
    timeoutMs: 12_000,
    systemPrompt: ' One sentence. ',
  }), {
    provider: 'local-provider',
    model: 'small-model',
    maxInputChars: 9_000,
    maxOutputTokens: 90,
    timeoutMs: 12_000,
    systemPrompt: 'One sentence.',
  });
});

test('rejects malformed config instead of silently changing behavior', () => {
  assert.throws(() => resolveSettings({ maxInputChars: 0 }), /positive safe integer/);
  assert.throws(() => resolveSettings({ maxOutputTokens: 1.5 }), /positive safe integer/);
  assert.throws(() => resolveSettings({ provider: '  ' }), /non-empty string/);
  assert.throws(() => resolveSettings(null as any), /must be an object/);
});
