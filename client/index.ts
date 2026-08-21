import type {
  ClientContext,
  ISessions,
  PendingInteractionStatus,
  SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client';

const SUMMARY_PATH = '/web-notify/summary';
const CAPABILITY_PATH = '/web-notify/capability';
const REQUIRE_INTERACTION = true;

interface Strings {
  completed: string;
  summarizing: string;
  pending: Record<PendingInteractionStatus, string>;
  pendingFallback: string;
}

export interface BrowserBindings {
  window: Window;
  document: Document;
  notification: typeof Notification | undefined;
  audioContext: typeof AudioContext | undefined;
  fetch: typeof fetch;
  language: string;
}

export interface WebNotifyClientContext {
  sessions: ISessions;
  on(name: 'connection/reset', callback: () => void): () => void;
}

export interface ClientOptions {
  summaryPollCount?: number;
  summaryPollIntervalMs?: number;
}

export function stringsForLanguage(language: string): Strings {
  return /^zh\b/i.test(language)
    ? {
        completed: '对话已完成',
        summarizing: '对话已完成 · 正在总结…',
        pending: {
          approval: '有一个授权请求等待处理',
          'plan-review': '有一个计划等待你的确认',
          question: '有一个问题等待你的回答',
        },
        pendingFallback: '有需要你处理的事项',
      }
    : {
        completed: 'Conversation finished',
        summarizing: 'Conversation finished · summarizing…',
        pending: {
          approval: 'An approval request is waiting for you',
          'plan-review': 'A plan is waiting for your review',
          question: 'A question is waiting for your answer',
        },
        pendingFallback: 'An action is waiting for you',
      };
}

function runtimeBindings(): BrowserBindings {
  return {
    window,
    document,
    notification: globalThis.Notification,
    audioContext: globalThis.AudioContext ?? (window as any).webkitAudioContext,
    fetch: window.fetch.bind(window),
    language: navigator.language ?? '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function capabilityResult(value: unknown): boolean {
  return isRecord(value) && value.summary === true;
}

function readySummary(value: unknown): string | undefined {
  return isRecord(value) && value.ready === true && typeof value.summary === 'string'
    ? value.summary
    : undefined;
}

function failedSummary(value: unknown): boolean {
  return isRecord(value) && value.ready === false && typeof value.error === 'string';
}

export function installWebNotifications(
  ctx: WebNotifyClientContext,
  browser: BrowserBindings = runtimeBindings(),
  options: ClientOptions = {},
): () => void {
  const strings = stringsForLanguage(browser.language);
  const summaryPollCount = options.summaryPollCount ?? 8;
  const summaryPollIntervalMs = options.summaryPollIntervalMs ?? 1_500;
  const sessions = ctx.sessions;
  const runningMap = new Map<string, boolean>();
  const pendingMap = new Map<string, PendingInteractionStatus | undefined>();
  const summaryGenerationMap = new Map<string, number>();
  const summaryTimerSet = new Set<number>();
  let summaryCapable = false;
  let disposed = false;
  let audioContext: AudioContext | undefined;

  for (const summary of Object.values(sessions.list.getSnapshot().byId)) {
    runningMap.set(summary.id, summary.running);
    pendingMap.set(summary.id, summary.pendingInteraction);
  }

  const nextSummaryGeneration = (id: string): number => {
    const generation = (summaryGenerationMap.get(id) ?? 0) + 1;
    summaryGenerationMap.set(id, generation);
    return generation;
  };

  const playChime = (): void => {
    try {
      const AudioContextClass = browser.audioContext;
      if (AudioContextClass === undefined) return;
      const context = audioContext ??= new AudioContextClass();
      if (context.state === 'suspended') void context.resume().catch(() => undefined);
      const start = context.currentTime;
      const playTone = (frequency: number, offset: number, duration: number): void => {
        const oscillator = audioContext!.createOscillator();
        const gain = audioContext!.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
        oscillator.connect(gain);
        gain.connect(audioContext!.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + duration + 0.05);
      };
      playTone(659.25, 0, 0.25);
      playTone(523.25, 0.18, 0.35);
    } catch {
      // Browser audio is optional and must never affect session navigation.
    }
  };

  const showNotification = (
    summary: SessionSummary,
    body: string,
    withChime: boolean,
  ): Notification | undefined => {
    const NotificationClass = browser.notification;
    if (NotificationClass === undefined || NotificationClass.permission !== 'granted') return undefined;
    try {
      const notification = new NotificationClass(summary.displayTitle, {
        body,
        tag: `dsh-session-${summary.id}`,
        silent: false,
        requireInteraction: REQUIRE_INTERACTION,
      });
      if (withChime) playChime();
      notification.onclick = () => {
        sessions.open(summary.id);
        browser.window.focus();
        notification.close();
      };
      browser.window.focus();
      return notification;
    } catch {
      return undefined;
    }
  };

  const schedule = (callback: () => void): void => {
    if (disposed) return;
    const id = browser.window.setTimeout(() => {
      summaryTimerSet.delete(id);
      if (!disposed) callback();
    }, summaryPollIntervalMs);
    summaryTimerSet.add(id);
  };

  const probeSummaryCapability = async (): Promise<void> => {
    try {
      const response = await browser.fetch(CAPABILITY_PATH, { cache: 'no-store' });
      const result = response.ok ? await response.json() : undefined;
      if (!disposed) summaryCapable = capabilityResult(result);
    } catch {
      if (!disposed) summaryCapable = false;
    }
  };

  const requestTurnSummary = (summary: SessionSummary): void => {
    const generation = nextSummaryGeneration(summary.id);
    let attempts = 0;
    const current = (): boolean =>
      !disposed && summaryGenerationMap.get(summary.id) === generation;
    const poll = async (): Promise<void> => {
      if (!current()) return;
      attempts += 1;
      if (attempts > summaryPollCount) {
        showNotification(summary, strings.completed, false);
        return;
      }
      try {
        const response = await browser.fetch(
          `${SUMMARY_PATH}?sessionId=${encodeURIComponent(summary.id)}`,
          { cache: 'no-store' },
        );
        const result = response.ok ? await response.json() : undefined;
        if (!current()) return;
        const text = readySummary(result);
        if (text !== undefined) {
          showNotification(summary, text, false);
        } else if (failedSummary(result)) {
          showNotification(summary, strings.completed, false);
        } else {
          schedule(() => void poll());
        }
      } catch {
        if (current()) schedule(() => void poll());
      }
    };
    schedule(() => void poll());
  };

  const isWatchingSession = (id: string, current: string | undefined): boolean =>
    browser.document.hasFocus() && current === id;

  const unsubscribe = sessions.list.subscribe(() => {
    const { byId, current } = sessions.list.getSnapshot();
    const liveIds = new Set(Object.keys(byId));
    for (const id of runningMap.keys()) {
      if (!liveIds.has(id)) {
        runningMap.delete(id);
        pendingMap.delete(id);
        nextSummaryGeneration(id);
      }
    }

    for (const summary of Object.values(byId)) {
      const id = summary.id;
      if (summary.origin === 'subagent') {
        runningMap.set(id, summary.running);
        pendingMap.set(id, summary.pendingInteraction);
        continue;
      }
      const previousPending = pendingMap.get(id);
      const previousRunning = runningMap.get(id);
      pendingMap.set(id, summary.pendingInteraction);
      runningMap.set(id, summary.running);

      if (summary.pendingInteraction !== undefined
        && summary.pendingInteraction !== previousPending) {
        nextSummaryGeneration(id);
        if (!isWatchingSession(id, current)) {
          showNotification(
            summary,
            strings.pending[summary.pendingInteraction] ?? strings.pendingFallback,
            true,
          );
        }
        continue;
      }
      if (summary.pendingInteraction !== undefined) continue;
      if (previousRunning !== true || summary.running !== false) continue;
      if (isWatchingSession(id, current)) continue;

      const notification = showNotification(
        summary,
        summaryCapable ? strings.summarizing : strings.completed,
        true,
      );
      if (notification !== undefined && summaryCapable) {
        requestTurnSummary(summary);
      } else {
        nextSummaryGeneration(id);
        if (!summaryCapable) void probeSummaryCapability();
      }
    }
  });

  const requestPermissionIfNeeded = (): void => {
    const NotificationClass = browser.notification;
    if (NotificationClass === undefined || NotificationClass.permission !== 'default') return;
    try {
      void NotificationClass.requestPermission().catch(() => undefined);
    } catch {
      // Permission prompts are best-effort and require a browser gesture.
    }
  };
  browser.window.addEventListener('pointerdown', requestPermissionIfNeeded, { capture: true });
  const disposeResetListener = ctx.on('connection/reset', () => {
    void probeSummaryCapability();
  });
  void probeSummaryCapability();

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    disposeResetListener();
    browser.window.removeEventListener('pointerdown', requestPermissionIfNeeded, { capture: true });
    for (const id of summaryTimerSet) browser.window.clearTimeout(id);
    summaryTimerSet.clear();
  };
}

export const name = 'web-notify';
export const inject = ['sessions'];

export function apply(ctx: ClientContext): void {
  ctx.inject(['sessions'], (scope) => {
    const dispose = installWebNotifications(scope as unknown as WebNotifyClientContext);
    scope.effect(() => dispose, 'web-notify: browser notifications');
  });
}
