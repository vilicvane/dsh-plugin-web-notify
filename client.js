window.__ModuleLoader__.load({
  id: "dsh-plugin-web-notify",
  factory: () => {
    const module = { exports: {} };
    const exports = module.exports;
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name2 in all)
        __defProp(target, name2, { get: all[name2], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // client/index.ts
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject,
      installWebNotifications: () => installWebNotifications,
      name: () => name,
      stringsForLanguage: () => stringsForLanguage
    });
    module.exports = __toCommonJS(index_exports);
    var SUMMARY_PATH = "/web-notify/summary";
    var CAPABILITY_PATH = "/web-notify/capability";
    var REQUIRE_INTERACTION = true;
    function stringsForLanguage(language) {
      return /^zh\b/i.test(language) ? {
        completed: "\u5BF9\u8BDD\u5DF2\u5B8C\u6210",
        summarizing: "\u5BF9\u8BDD\u5DF2\u5B8C\u6210 \xB7 \u6B63\u5728\u603B\u7ED3\u2026",
        pending: {
          approval: "\u6709\u4E00\u4E2A\u6388\u6743\u8BF7\u6C42\u7B49\u5F85\u5904\u7406",
          "plan-review": "\u6709\u4E00\u4E2A\u8BA1\u5212\u7B49\u5F85\u4F60\u7684\u786E\u8BA4",
          question: "\u6709\u4E00\u4E2A\u95EE\u9898\u7B49\u5F85\u4F60\u7684\u56DE\u7B54"
        },
        pendingFallback: "\u6709\u9700\u8981\u4F60\u5904\u7406\u7684\u4E8B\u9879"
      } : {
        completed: "Conversation finished",
        summarizing: "Conversation finished \xB7 summarizing\u2026",
        pending: {
          approval: "An approval request is waiting for you",
          "plan-review": "A plan is waiting for your review",
          question: "A question is waiting for your answer"
        },
        pendingFallback: "An action is waiting for you"
      };
    }
    function runtimeBindings() {
      return {
        window,
        document,
        notification: globalThis.Notification,
        audioContext: globalThis.AudioContext ?? window.webkitAudioContext,
        fetch: window.fetch.bind(window),
        language: navigator.language ?? ""
      };
    }
    function isRecord(value) {
      return value !== null && typeof value === "object";
    }
    function capabilityResult(value) {
      return isRecord(value) && value.summary === true;
    }
    function readySummary(value) {
      return isRecord(value) && value.ready === true && typeof value.summary === "string" ? value.summary : void 0;
    }
    function failedSummary(value) {
      return isRecord(value) && value.ready === false && typeof value.error === "string";
    }
    function continuingSummary(value) {
      return isRecord(value) && value.ready === false && value.continuing === true;
    }
    function projectedNotification(summary) {
      const value = summary.projectionValues?.webNotifyRequest;
      return isRecord(value) && value.version === 1 && typeof value.requestId === "string" && value.requestId.length > 0 && typeof value.message === "string" && value.message.length > 0 ? value : void 0;
    }
    function projectedCompletion(summary) {
      const value = summary.projectionValues?.webNotifyCompletion;
      return isRecord(value) && value.version === 1 && Number.isSafeInteger(value.turn) && Number.isSafeInteger(value.endSeq) && typeof value.continues === "boolean" ? value : void 0;
    }
    function installWebNotifications(ctx, browser = runtimeBindings(), options = {}) {
      const strings = stringsForLanguage(browser.language);
      const summaryPollCount = options.summaryPollCount ?? 8;
      const summaryPollIntervalMs = options.summaryPollIntervalMs ?? 1500;
      const sessions = ctx.sessions;
      const runningMap = /* @__PURE__ */ new Map();
      const pendingMap = /* @__PURE__ */ new Map();
      const notificationRequestMap = /* @__PURE__ */ new Map();
      const summaryGenerationMap = /* @__PURE__ */ new Map();
      const summaryTimerSet = /* @__PURE__ */ new Set();
      let summaryCapable = false;
      let disposed = false;
      let audioContext;
      const pendingInteractions = ctx.uiSession.pendingInteractions;
      for (const summary of Object.values(sessions.list.getSnapshot().byId)) {
        runningMap.set(summary.id, summary.running);
        pendingMap.set(summary.id, pendingInteractions.getSnapshot().get(summary.id)?.key);
        notificationRequestMap.set(summary.id, projectedNotification(summary)?.requestId);
      }
      const nextSummaryGeneration = (id) => {
        const generation = (summaryGenerationMap.get(id) ?? 0) + 1;
        summaryGenerationMap.set(id, generation);
        return generation;
      };
      const playChime = () => {
        try {
          const AudioContextClass = browser.audioContext;
          if (AudioContextClass === void 0) return;
          const context = audioContext ??= new AudioContextClass();
          if (context.state === "suspended") void context.resume().catch(() => void 0);
          const start = context.currentTime;
          const playTone = (frequency, offset, duration) => {
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(1e-4, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(1e-4, start + offset + duration);
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(start + offset);
            oscillator.stop(start + offset + duration + 0.05);
          };
          playTone(659.25, 0, 0.25);
          playTone(523.25, 0.18, 0.35);
        } catch {
        }
      };
      const showNotification = (summary, body, withChime) => {
        const NotificationClass = browser.notification;
        if (NotificationClass === void 0 || NotificationClass.permission !== "granted") return void 0;
        try {
          const notification = new NotificationClass(summary.displayTitle, {
            body,
            tag: `dsh-session-${summary.id}`,
            silent: false,
            requireInteraction: REQUIRE_INTERACTION
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
          return void 0;
        }
      };
      const schedule = (callback) => {
        if (disposed) return;
        const id = browser.window.setTimeout(() => {
          summaryTimerSet.delete(id);
          if (!disposed) callback();
        }, summaryPollIntervalMs);
        summaryTimerSet.add(id);
      };
      const probeSummaryCapability = async () => {
        try {
          const response = await browser.fetch(CAPABILITY_PATH, { cache: "no-store" });
          const result = response.ok ? await response.json() : void 0;
          if (!disposed) summaryCapable = capabilityResult(result);
        } catch {
          if (!disposed) summaryCapable = false;
        }
      };
      const requestTurnSummary = (summary, placeholder) => {
        const generation = nextSummaryGeneration(summary.id);
        let attempts = 0;
        const current = () => !disposed && summaryGenerationMap.get(summary.id) === generation;
        const poll = async () => {
          if (!current()) return;
          attempts += 1;
          if (attempts > summaryPollCount) {
            showNotification(summary, strings.completed, false);
            return;
          }
          try {
            const response = await browser.fetch(
              `${SUMMARY_PATH}?sessionId=${encodeURIComponent(summary.id)}`,
              { cache: "no-store" }
            );
            const result = response.ok ? await response.json() : void 0;
            if (!current()) return;
            const text = readySummary(result);
            if (text !== void 0) {
              showNotification(summary, text, false);
            } else if (continuingSummary(result)) {
              placeholder.close();
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
      const isWatchingSession = (id, current) => browser.document.hasFocus() && current === id;
      const updateNotifications = () => {
        const { byId, current } = sessions.list.getSnapshot();
        const liveIds = new Set(Object.keys(byId));
        for (const id of runningMap.keys()) {
          if (!liveIds.has(id)) {
            runningMap.delete(id);
            pendingMap.delete(id);
            notificationRequestMap.delete(id);
            nextSummaryGeneration(id);
          }
        }
        const pendingBySession = pendingInteractions.getSnapshot();
        for (const summary of Object.values(byId)) {
          const id = summary.id;
          const pending = pendingBySession.get(id);
          const hadNotificationBaseline = notificationRequestMap.has(id);
          const notificationRequest = projectedNotification(summary);
          const previousNotificationRequestId = notificationRequestMap.get(id);
          notificationRequestMap.set(id, notificationRequest?.requestId);
          if (summary.origin === "subagent") {
            runningMap.set(id, summary.running);
            pendingMap.set(id, pending?.key);
            continue;
          }
          const previousPending = pendingMap.get(id);
          const previousRunning = runningMap.get(id);
          pendingMap.set(id, pending?.key);
          runningMap.set(id, summary.running);
          const hasNewNotification = hadNotificationBaseline && notificationRequest !== void 0 && notificationRequest.requestId !== previousNotificationRequestId;
          if (hasNewNotification) nextSummaryGeneration(id);
          if (pending !== void 0 && pending.key !== previousPending) {
            nextSummaryGeneration(id);
            if (!isWatchingSession(id, current)) {
              showNotification(
                summary,
                strings.pending[pending.kind] ?? strings.pendingFallback,
                true
              );
            }
            continue;
          }
          if (pending !== void 0) continue;
          if (hasNewNotification) {
            if (!isWatchingSession(id, current)) {
              showNotification(summary, notificationRequest.message, true);
            }
            continue;
          }
          if (previousRunning !== true || summary.running !== false) continue;
          if (isWatchingSession(id, current)) continue;
          if (projectedCompletion(summary)?.continues === true) {
            nextSummaryGeneration(id);
            continue;
          }
          const notification = showNotification(
            summary,
            summaryCapable ? strings.summarizing : strings.completed,
            true
          );
          if (notification !== void 0 && summaryCapable) {
            requestTurnSummary(summary, notification);
          } else {
            nextSummaryGeneration(id);
            if (!summaryCapable) void probeSummaryCapability();
          }
        }
      };
      const unsubscribe = sessions.list.subscribe(updateNotifications);
      const unsubscribePending = pendingInteractions.subscribe(updateNotifications);
      const requestPermissionIfNeeded = () => {
        const NotificationClass = browser.notification;
        if (NotificationClass === void 0 || NotificationClass.permission !== "default") return;
        try {
          void NotificationClass.requestPermission().catch(() => void 0);
        } catch {
        }
      };
      browser.window.addEventListener("pointerdown", requestPermissionIfNeeded, { capture: true });
      const disposeResetListener = ctx.on("connection/reset", () => {
        void probeSummaryCapability();
      });
      void probeSummaryCapability();
      return () => {
        if (disposed) return;
        disposed = true;
        unsubscribe();
        unsubscribePending();
        disposeResetListener();
        browser.window.removeEventListener("pointerdown", requestPermissionIfNeeded, { capture: true });
        for (const id of summaryTimerSet) browser.window.clearTimeout(id);
        summaryTimerSet.clear();
      };
    }
    var name = "web-notify";
    var inject = ["sessions", "uiSession"];
    function apply(ctx) {
      const dispose = installWebNotifications({
        sessions: ctx.sessions,
        uiSession: ctx.uiSession,
        on: (event, callback) => ctx.on(event, callback)
      });
      ctx.effect(() => dispose, "web-notify: browser notifications");
    }
    return module.exports;
  },
});
