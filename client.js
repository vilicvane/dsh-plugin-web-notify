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
     * watching it.
     */
    const name = 'web-notify';

    const language =
      typeof navigator === 'undefined' ? '' : navigator.language ?? '';
    const isChinese = /^zh\b/i.test(language);

    const STRINGS = isChinese
      ? {
          completed: '对话已完成',
          pending: {
            approval: '有一个授权请求等待处理',
            'plan-review': '有一个计划等待你的确认',
            question: '有一个问题等待你的回答',
          },
          pendingFallback: '有需要你处理的事项',
        }
      : {
          completed: 'Conversation finished',
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

        const notifySession = (summary, body) => {
          if (!('Notification' in window)) {
            return;
          }

          if (Notification.permission !== 'granted') {
            return;
          }

          try {
            // The tag replaces the previous notification for the same session
            // instead of stacking one toast per event.
            const notification = new Notification(summary.displayTitle, {
              body,
              tag: `dsh-session-${summary.id}`,
              silent: false,
            });

            playChime();

            // Clicking the toast is a user gesture: focusing the GUI window
            // is allowed here.
            notification.onclick = () => {
              window.focus();
              notification.close();
            };

            // Best-effort activation without a click; most browsers silently
            // ignore window.focus() without a user gesture, so the click
            // handler above is the reliable path.
            window.focus();
          } catch {
            // Notifications must never affect the GUI.
          }
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
                notifySession(
                  summary,
                  STRINGS.pending[summary.pendingInteraction] ??
                    STRINGS.pendingFallback,
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

            notifySession(summary, STRINGS.completed);
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
          window.removeEventListener('pointerdown', handlePointerDown, {
            capture: true,
          });
        });
      });
    }

    exports.apply = apply;
    exports.name = name;
    return module.exports;
  },
});
