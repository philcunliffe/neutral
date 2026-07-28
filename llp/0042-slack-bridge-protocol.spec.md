# LLP 0042: The Slack bridge protocol — framing, keyed threads, and fabric changes

**Type:** Spec
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0013, 0026, 0034, 0038, 0039, 0040, 0041

## Purpose

The concrete contract realizing LLP 0039/0040/0041: message formats, the
injection discipline, the notification key, and the entrypoint/watchdog
changes. Implementation code annotates against the anchors here.

## Config surface

| Var | Meaning |
|---|---|
| `SLACK_BOT_TOKEN` | Bot token — outbound `chat.postMessage`, history reads |
| `SLACK_APP_TOKEN` | App-level token — the Socket Mode connection |
| `SLACK_CHANNEL_ID` | The one channel the mayor lives in |
| `SLACK_ALLOWED_USER_IDS` | Comma-separated allowlist, enforced at the bridge |
| `NEUTRAL_MAYOR` | `1` enables mayor + bridge (default `0` until the app exists) |
| `NEUTRAL_MAYOR_MODEL` | Mayor's model; empty = same as the loops |

The entrypoint exports **`NEUTRAL_MAYOR_CMD`** (the full pinned claude
command) — the single respawn source for supervisor, watchdog, and the
mayor's recycle (LLP 0039 §mutual-coverage).

## Inbound (bridge → mayor)

<a id="inbound-framing"></a>A channel or thread message from an allowlisted
user is injected as one pane message, LLP 0034 discipline (`C-u` first; never
Enter on text the bridge did not type; verify submission):

```
[slack <user_id> ts=<message_ts> thread=<thread_ts|none>] <text verbatim>
```

`thread` carries the root's `ts`, so the mayor resolves *which* event a reply
answers by matching the root's key line — never by inferring from prose.
Non-allowlisted messages are dropped at the bridge (LLP 0040 §allowlist).

## Outbound (mayor → Slack)

<a id="notification-key"></a>**Push notifications** (the three LLP 0041
§push-pull events) are one root message per event whose first line is the
machine-findable key, mirroring LLP 0026's head-keyed baseline:

```
[neutral <repo>#<pr> <state>@<headSHA>]        state ∈ ready-to-merge | stuck
[neutral session=<name> unhealed@<lastEventISO>]   (failed-heal event)
```

Same event → same key → posted at most once; a re-stick at a new head is a
new key and notifies afresh.

> **Extended-by [LLP 0043](0043-issue-push-events.decision.md):** issue-family
> keys `[neutral <repo>#<issue> fix-queued]` and `[neutral <repo>#<issue>
> issue-stuck]` — suffix-free (issues have no head SHA), same dedupe.

<a id="dedupe"></a>**Dedupe is a bounded `conversations.history` scan** for
the key (a bot token cannot use Slack search) — Slack is the ground truth for
what has been reported; no notification ledger exists (LLP 0002). Bounded
lookback (and free-plan 90-day retention) means a long-ignored artifact may
re-announce once past the window — accepted as a periodic nag.

<a id="stuck-relay"></a>**Stuck-reply relay**: a thread reply under a `stuck`
root posts to that PR as a comment — the human's text verbatim, **no
marker**, followed by a blank line and `— relayed from Slack` (LLP 0041
§identity-principle). Then confirm in the thread. Mayor-authored GitHub
comments (if any) always carry a `<!-- neutral-mayor -->` marker.

## Fabric changes

- **Entrypoint**: spawn `slack-bridge` and `neutral-mayor` sessions when
  `NEUTRAL_MAYOR=1`; export `NEUTRAL_MAYOR_CMD`; supervisor respawns dead
  bridge and dead mayor (LLP 0039 §mutual-coverage). Pre-trust and
  hyp-classify `/work` exactly as for the watchdog.
- **Watchdog skill**: recognize `neutral-mayor` by name; apply the unchanged
  45-minute predicate (LLP 0039 §tick-contract); heal via
  `NEUTRAL_MAYOR_CMD`, never the `neutral-*`→`/work/<name>` reconcile
  mapping.
- **Mayor skill** (`/neutral-mayor`): the tick = scan for the three push
  events, answer any unanswered inbound, then recycle-or-schedule per
  LLP 0039 §recycle.

## Requirements

- **R1 — verbatim or nothing.** A relay (pane or GitHub) reproduces the
  human's text exactly; if the mayor cannot (length, formatting), it says so
  in the thread instead of paraphrasing.
- **R2 — no irreversible acts** (LLP 0041 §no-irreversible), regardless of
  what an inbound message asks.
- **R3 — ground truth only.** Every answer and every push event is
  re-derived at read time (git, `gh`, transcripts, `neutral * --json`,
  channel history); the mayor keeps no state file.
- **R4 — bridge determinism.** The bridge contains no model calls and no
  parsing beyond allowlist + framing; it is offline-testable with a fake
  tmux target.
- **R5 — degraded mode.** Bridge down → the mayor's tick still pushes
  notifications outbound and may poll `conversations.history` for inbound
  (LLP 0040 rejected-polling, kept as fallback).
