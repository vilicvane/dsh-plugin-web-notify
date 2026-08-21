# Web Notify Design

## Purpose

Web Notify is a presentation plugin. It observes session-list state in the Web
client and produces browser notifications for three events:

1. a user-facing agent explicitly requests a meaningful intermediate update;
2. a root conversation becomes idle after running; and
3. a root conversation gains an approval, plan-review, or question wait.

The explicit request is a normal tool call and result on the transcript. It
does not end the turn, inject model context, or add a private event type.
Notification summaries are optional presentation data and must degrade to
fixed localized text on every failure path.

## Host and client boundary

The browser owns visibility, notification permission, OS toasts, sound, and
session navigation. It has no model credentials and never reads a transcript.

The host owns transcript access and auxiliary model calls. It exposes only:

- `GET|HEAD /web-notify/capability`; and
- `GET|HEAD /web-notify/summary?sessionId=...`.

Both responses are non-cacheable JSON. Other methods and paths are rejected.
The host route is registered and disposed through the plugin's Cordis effect.

## Agent-requested notifications

`web_notify__send(message)` is available only to user-facing agent sessions.
Its message is one concise, standalone update. The tool description reserves
it for meaningful milestones or attention-worthy updates during long-running
work; completion and pending-interaction notifications stay automatic.

On success, the tool returns normally so the current turn continues. Its
standard `tool/result.meta` carries a versioned request envelope. In Code Mode,
where nested result presentation metadata is intentionally omitted, the same
request is recovered from the standard successful `tool/code-dispatch` event's
name, arguments, and sub-call id. No downstream-private session event is
written, so removing this plugin cannot make stored sessions unreadable.

The `webNotifyRequest` session projection retains only the latest request.
`requestId` is the native call id or Code Mode sub-call id and is the client
deduplication identity. The projection is delivered through the existing
session-list snapshot; no notification polling route or additional client
connection is needed.

## Completed-turn semantics

A summary source is the latest structurally closed interval whose
`turn/start.turn` matches `turn/end.turn`. Extraction is bounded to events
inside that interval:

- human `user/message` text is retained in interaction order;
- text-bearing `assistant/message` blocks for the same turn are retained in
  order;
- tool results, reasoning blocks, plugin/runtime user messages, earlier turns,
  and a later open turn are excluded.

Each side is tail-capped by `maxInputChars`, preserving recent corrections,
steers, progress, and the final answer. The closing `turn/end.seq` is the
summary identity. Post-turn surface replacements therefore do not cause the
same completed turn to be summarized again.

## Model call and cache

The summary call uses `ctx.llm.stream` with `purpose: session-title`. The
request is a plugin-sourced immutable user message containing language-neutral
human/assistant boundaries. The configurable system prompt owns output style.

Concurrent HTTP requests for the same session and closing seq share one
promise. Ready and failed results are cached by that exact identity, so polling
cannot multiply model calls. The cache retains at most 200 completed-turn
entries. Plugin disposal aborts every in-flight request.

## Client state machine

The client seeds its running and pending maps from the current session-list
snapshot. It also seeds the latest explicit request id so an old request is
never replayed after load or reconnect. It then reacts only to transitions:

- a changed `webNotifyRequest.requestId` produces the agent-authored toast;
- `running: true → false` produces a completion toast unless that session is
  currently visible and focused;
- a new or changed `pendingInteraction` produces the actionable toast, and an
  unresolved pending interaction continues to suppress completion notices;
- subagent rows update baselines but never notify.

Priority within one snapshot is pending interaction, explicit request, then
completion. A lower-priority transition still advances its baseline so it
cannot replay after the higher-priority state clears. Every explicit request
also invalidates an in-flight completion summary before any toast decision.

Every session has a monotonically increasing summary generation. Starting a
new summary, receiving a pending interaction, or removing the session advances
that generation. Poll callbacks check it before fetching and again before
showing a result. Consequently an old completion summary cannot overwrite a
new approval/question notification that uses the same browser-notification
tag.

All timers, subscriptions, event listeners, and connection-reset listeners are
disposed with the client fiber. Async callbacks also check the disposed flag so
they cannot recreate timers after teardown.

## Source and distribution

`client/index.ts` is the browser source of truth. `client.js` is a deterministic
esbuild artifact wrapped for `window.__ModuleLoader__`; it remains committed so
installing from GitHub or npm needs no build toolchain. `pnpm check:client`
fails when the artifact is stale.

The host ships TypeScript directly, matching the DSH plugin loader convention
used by Turn Memory and Todo Stack. Tests cover pure turn extraction, config,
model-call deduplication/failure caching, HTTP behavior, Cordis registration,
browser transition behavior, stale-summary invalidation, and the generated
client module.
