export interface Config {
  provider?: string;
  model?: string;
  maxInputChars?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  systemPrompt?: string;
}

export interface Settings {
  provider: string;
  model: string;
  maxInputChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  systemPrompt: string;
}

export const DEFAULT_SYSTEM_PROMPT = [
  'You write short summaries of completed coding-agent work segments for desktop notifications.',
  'A segment may span several automatically continued turns. Reply with exactly one concise sentence of at most 30 words describing what was accomplished across the segment.',
  'Answer in the language used by the human input when it is present; otherwise follow the assistant output.',
  'Do not use a preamble or markdown.',
].join(' ');

const DEFAULTS: Settings = {
  provider: 'deepseek-official',
  model: 'deepseek-chat',
  maxInputChars: 4_000,
  maxOutputTokens: 150,
  timeoutMs: 60_000,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

function optionalNonEmptyString(value: unknown, fallback: string, name: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`web-notify ${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalPositiveInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`web-notify ${name} must be a positive safe integer`);
  }
  return value as number;
}

export function resolveSettings(config: Config = {}): Settings {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('web-notify config must be an object');
  }
  return {
    provider: optionalNonEmptyString(config.provider, DEFAULTS.provider, 'provider'),
    model: optionalNonEmptyString(config.model, DEFAULTS.model, 'model'),
    maxInputChars: optionalPositiveInteger(
      config.maxInputChars,
      DEFAULTS.maxInputChars,
      'maxInputChars',
    ),
    maxOutputTokens: optionalPositiveInteger(
      config.maxOutputTokens,
      DEFAULTS.maxOutputTokens,
      'maxOutputTokens',
    ),
    timeoutMs: optionalPositiveInteger(config.timeoutMs, DEFAULTS.timeoutMs, 'timeoutMs'),
    systemPrompt: optionalNonEmptyString(
      config.systemPrompt,
      DEFAULTS.systemPrompt,
      'systemPrompt',
    ),
  };
}
