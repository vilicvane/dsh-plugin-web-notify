# dsh-plugin-web-notify

Browser notifications for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web GUI.

Shows a browser notification when:

- a conversation turn finishes while you are not watching that session;
- the agent starts waiting for you — an approval request, a plan review, or a question.

## Features

- **Click to focus** — clicking the notification brings the GUI window to the front.
- **Chime** — plays a short two-tone sound along with the notification (browsers allow page audio after the page has been interacted with at least once).
- **No interruptions** — no notification while the page is focused on the finished/asking session; you already see it.
- **One toast per session** — notifications for the same session replace each other instead of stacking.
- **Subagents ignored** — subagent sessions do not produce notifications.
- **Permission on first click** — the notification permission is requested automatically on the first click inside the page; grant it once and you are done.
- **Bilingual** — notification text follows the browser language (Chinese / English).

## Install

Add the plugin to your dsh profile and register it in the Loader:

```sh
dsh plugin --profile web add dsh-plugin-web-notify
```

Then append an insert row to the profile's `cordis.patch.yml`
(`$DSH_HOME/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: web-notify
      name: dsh-plugin-web-notify
```

Restart `dsh web`, refresh the page, and click anywhere once to grant the
notification permission.

## How it works

- `index.js` (host half) is intentionally empty: it exists so the plugin
  appears in the host Loader. The client-modules scan reads the `dsh.client`
  declaration from `package.json` and enrolls the browser bundle into
  `window.__DSH_BOOT__`.
- `client.js` (client half) is a Cordis client plugin. It injects the
  `sessions` service and watches the session-list snapshot for
  `running → false` transitions and for `pendingInteraction`
  (`approval` / `plan-review` / `question`) arrivals.

## Notes

- Windows may deliver Chrome notifications quietly (notification center
  only, no banner, no sound). Check **Windows Settings → System →
  Notifications → Google Chrome** and enable "Show notification banners" and
  "Play a sound"; also make sure Focus Assist is off.
- The chime is subject to the browser autoplay policy: it plays only after
  the page has been interacted with at least once.
- Bringing a window to the front without a user gesture is restricted by
  browsers, so automatic focusing on show is best-effort; clicking the
  notification always focuses the window.

## License

MIT
