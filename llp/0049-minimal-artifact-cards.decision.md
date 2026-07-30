# LLP 0049: Minimal artifact cards — one root per artifact; detail in thread

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-30
**Related:** 0002, 0041, 0042, 0043, 0044, 0046, 0050

## Context

LLP 0046 gave event roots readable titles, but the roots stayed verbose: the
full answer-ready body (state, needs, links, reply instructions) sits in the
channel, and one-root-per-event means a re-stick or a state change spawns a
*new* pinned message beside the old one's history. The channel and the pin
queue are hard to scan. What the human needs at a glance is tiny: which
artifact, what state, any merge complication, one sentence of what it is.
Everything else is depth, and Slack already has a place for depth — the
thread.

## Decision

<a id="card-shape"></a>**The root message is a minimal card.** Block Kit:

- `header` — `<repo-short>#<n>` (session events: `watchdog — <session>`).
- `section` — a **status line** (indicator emoji + one status word, e.g.
  `🟢 approved` · `🔴 stuck` · `🟠 fix-queued` · `🔴 issue-stuck` ·
  `🔴 unhealed`), then a **one-sentence description** of the PR/issue with
  its GitHub link.
- optional `section` — **⚠️ warning**, present only when there are merge
  complications: an unmerged predecessor to merge first, or a caveat to
  merging. Same derived facts as the PR body's merge-notes block
  ([LLP 0050](0050-merge-notes-in-pr-body.decision.md)), each re-derived
  from ground truth — never read back from either surface (LLP 0002).
- `context` — the artifact key (below).

Nothing else. Full state, what it needs, what a reply does, and every
event's detail post as **thread replies under the root**, where depth is
free and the channel stays quiet.

<a id="artifact-roots"></a>**One root per artifact, not per event.** The
root key drops the state so it survives state changes:

```
[neutral <owner/repo>#<n>]        (PRs and issues — shared number space)
[neutral session=<name>]          (session events)
```

The stateful event keys (LLP 0042 §notification-key, LLP 0043 §issue-keys —
formats unchanged) move into the thread: each event's detail reply carries
its event key, and **per-event dedupe matches event keys in the root's
`conversations.replies`** (bounded history stays the fallback). A new event
on an artifact that already has a root is a card update plus a detail reply
posted with `reply_broadcast: true` — the channel still gets pushed, without
a second root.

<a id="card-update"></a>**The card is kept current by `chat.update`,
replaced whole.** Whenever re-derived state differs from what the card
should show, rebuild the full block list and update in place — a rendered
view with no memory of its previous self (the LLP 0045 §canvas-view
discipline applied to one message). Edits notify nobody, so keeping status
current does not violate the only-event-roots-post rule (LLP 0041
§push-pull).

<a id="root-reuse"></a>**Unpin on resolve; reuse the root on recurrence.**
The pin invariant is unchanged — pinned set ≡ artifacts currently waiting
on a human (LLP 0044 §pin-lifecycle, now artifact-grained). When a resolved
artifact waits again, find its root by artifact key (pins, then bounded
history), update the card, re-pin, and thread the new event's detail — the
artifact's whole story stays in one thread. Past the history window a fresh
root is minted: the accepted periodic nag, unchanged.

## Consequences

- Mayor skill: push step posts/updates minimal cards; dedupe becomes
  two-level (artifact key → root, event key → thread reply); thread-reply
  resolution still matches the root's key in `text`, now state-free.
- LLP 0042 §notification-key + §dedupe, LLP 0043 §issue-keys, LLP 0044
  §pin-lifecycle, and LLP 0046 §root-shape gain `Extended-by: 0049`
  forward-refs. Old-format roots (stateful key in `text`) still match a
  substring search on the artifact prefix; no migration.
- No bridge or entrypoint change.
