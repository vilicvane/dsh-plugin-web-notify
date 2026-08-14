window.__ModuleLoader__.load({
  id: 'dsh-plugin-web-notify',
  factory: () => {
    var module = {exports: {}};
    var exports = module.exports;

    Object.defineProperty(exports, Symbol.toStringTag, {value: 'Module'});

    /**
     * Web notification plugin, client half: fires a browser notification
     * when a session's turn finishes or when a session starts waiting for the
     * user (approval, plan review, or a question) while the user is not
     * watching it. Completion notifications are upgraded to a host-generated
     * small-model summary when one becomes available.
     */
    const name = 'web-notify';

    /**
     * Whether notifications stay on screen until the user clicks or dismisses
     * them. Browsers do not expose a configurable auto-dismiss duration — the
     * operating system controls it — so `requireInteraction` is the only way
     * to keep a notification visible for longer. Set to false for the OS
     * default auto-dismiss timing.
     */
    const REQUIRE_INTERACTION = true;

    const language =
      typeof navigator === 'undefined' ? '' : navigator.language ?? '';
    const isChinese = /^zh\b/i.test(language);

    const STRINGS = isChinese
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

    let audioContext;

    /**
     * Plays a short two-tone chime through Web Audio. Browsers allow page
     * audio without a gesture after the user has interacted with the page;
     * while blocked, this fails silently and the notification still shows.
     */
    const playChime = () => {
      try {
        const AudioContextClass =
          window.AudioContext ?? window.webkitAudioContext;

        if (AudioContextClass === undefined) {
          return;
        }

        audioContext ??= new AudioContextClass();

        if (audioContext.state === 'suspended') {
          void audioContext.resume().catch(() => undefined);
        }

        const start = audioContext.currentTime;
        const playTone = (frequency, offset, duration) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.0001, start + offset);
          gain.gain.exponentialRampToValueAtTime(0.3, start + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            start + offset + duration,
          );
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(start + offset);
          oscillator.stop(start + offset + duration + 0.05);
        };

        playTone(659.25, 0, 0.25); // E5
        playTone(523.25, 0.18, 0.35); // C5
      } catch {
        // Sound must never affect the GUI.
      }
    };

    function apply(ctx) {
      ctx.inject(['sessions'], scope => {
        const sessions = scope.sessions;

        const runningMap = new Map();
        const pendingMap = new Map();

        // Seed with the current snapshot so a transition that is already in
        // flight when this plugin activates still notifies when it settles.
        for (const [id, summary] of Object.entries(
          sessions.list.getSnapshot().byId,
        )) {
          runningMap.set(id, summary.running);
          pendingMap.set(id, summary.pendingInteraction);
        }

        const requestPermissionIfNeeded = () => {
          if (!('Notification' in window)) {
            return;
          }

          if (Notification.permission !== 'default') {
            return;
          }

          try {
            // Requesting permission requires a user gesture, hence the
            // pointerdown listener below.
            void Notification.requestPermission().catch(() => undefined);
          } catch {
            // Permission prompts must never affect the GUI.
          }
        };

        const showNotification = (summary, body, withChime) => {
          if (!('Notification' in window)) {
            return undefined;
          }

          if (Notification.permission !== 'granted') {
            return undefined;
          }

          try {
            // The tag replaces the previous notification for the same session
            // instead of stacking one toast per event.
            const notification = new Notification(summary.displayTitle, {
              body,
              tag: `dsh-session-${summary.id}`,
              silent: false,
              requireInteraction: REQUIRE_INTERACTION,
            });

            if (withChime) {
              playChime();
            }

            // Clicking the toast is a user gesture: focusing the GUI window
            // and switching to the finished session are both allowed here.
            notification.onclick = () => {
              sessions.open(summary.id);
              window.focus();
              notification.close();
            };

            // Best-effort activation without a click; most browsers silently
            // ignore window.focus() without a user gesture, so the click
            // handler above is the reliable path.
            window.focus();

            return notification;
          } catch {
            // Notifications must never affect the GUI.
            return undefined;
          }
        };

        const SUMMARY_PATH = '/web-notify/summary';
        const CAPABILITY_PATH = '/web-notify/capability';
        const SUMMARY_POLL_COUNT = 8;
        const SUMMARY_POLL_INTERVAL_MS = 1_500;

        const summaryTimerSet = new Set();

        const scheduleSummaryTimer = callback => {
          const id = window.setTimeout(() => {
            summaryTimerSet.delete(id);
            callback();
          }, SUMMARY_POLL_INTERVAL_MS);

          summaryTimerSet.add(id);
        };

        // Whether the host half can summarize turns. Probed at apply and
        // self-heals: a probe that ran before the host half was deployed (or
        // before a server restart) must not stick as "unavailable" forever.
        let summaryCapable = false;

        const probeSummaryCapability = () => {
          fetch(CAPABILITY_PATH)
            .then(response => response.json())
            .then(result => {
              summaryCapable =
                result !== null &&
                typeof result === 'object' &&
                result.summary === true;
            })
            .catch(() => undefined);
        };

        probeSummaryCapability();

        // The connection resets when the dsh web server restarts; the new
        // process may mount the summary route, so probe again.
        const disposeResetListener = ctx.on('connection/reset', () => {
          probeSummaryCapability();
        });

        // Replaces the completion notification with the host-generated
        // small-model summary once it is ready; when it never becomes ready,
        // the "summarizing" hint degrades back to the plain text.
        const requestTurnSummary = summary => {
          let attempts = 0;

          const poll = () => {
            attempts++;

            if (attempts > SUMMARY_POLL_COUNT) {
              showNotification(summary, STRINGS.completed, false);
              return;
            }

            fetch(
              `${SUMMARY_PATH}?sessionId=${encodeURIComponent(summary.id)}`,
            )
              .then(response => response.json())
              .then(result => {
                if (
                  result === null ||
                  typeof result !== 'object' ||
                  result.ready !== true ||
                  typeof result.summary !== 'string'
                ) {
                  scheduleSummaryTimer(poll);
                  return;
                }

                // Same tag replaces the plain notification.
                showNotification(summary, result.summary, false);
              })
              .catch(() => {
                scheduleSummaryTimer(poll);
              });
          };

          scheduleSummaryTimer(poll);
        };

        const isWatchingSession = (id, current) => {
          return document.hasFocus() && current === id;
        };

        const unsubscribe = sessions.list.subscribe(() => {
          const {byId, current} = sessions.list.getSnapshot();

          for (const [id, summary] of Object.entries(byId)) {
            // Subagent sessions are noise.
            if (summary.origin === 'subagent') {
              runningMap.set(id, summary.running);
              pendingMap.set(id, summary.pendingInteraction);
              continue;
            }

            const previousPending = pendingMap.get(id);
            const previousRunning = runningMap.get(id);
            pendingMap.set(id, summary.pendingInteraction);
            runningMap.set(id, summary.running);

            if (
              previousPending === undefined &&
              summary.pendingInteraction !== undefined
            ) {
              if (!isWatchingSession(id, current)) {
                showNotification(
                  summary,
                  STRINGS.pending[summary.pendingInteraction] ??
                    STRINGS.pendingFallback,
                  true,
                );
              }

              // The pending interaction is the actionable event; do not also
              // notify the completion that may arrive in the same update.
              continue;
            }

            if (previousRunning !== true || summary.running !== false) {
              continue;
            }

            if (isWatchingSession(id, current)) {
              continue;
            }

            const notification = showNotification(
              summary,
              summaryCapable ? STRINGS.summarizing : STRINGS.completed,
              true,
            );

            if (notification !== undefined && summaryCapable) {
              requestTurnSummary(summary);
            } else if (!summaryCapable) {
              // Lazy self-heal: the next completion gets the summary flow.
              probeSummaryCapability();
            }
          }
        });

        const handlePointerDown = () => {
          requestPermissionIfNeeded();
        };

        window.addEventListener('pointerdown', handlePointerDown, {
          capture: true,
        });

        scope.effect(() => () => {
          unsubscribe();
          disposeResetListener();
          window.removeEventListener('pointerdown', handlePointerDown, {
            capture: true,
          });

          for (const id of summaryTimerSet) {
            window.clearTimeout(id);
          }

          summaryTimerSet.clear();
        });
      });
    }

    exports.apply = apply;
    exports.name = name;
    return module.exports;
  },
});
