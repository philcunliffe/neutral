# LLP 0044: Pinned event roots — the pin list is the live waiting-on-you queue

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-28
**Related:** 0002, 0041, 0042, 0043

## Context

Event roots (LLP 0042/0043 keyed messages) scroll away as the channel moves;
the human loses track of which items still wait on them. Slack's forum-like
surfaces were considered: Lists (API is paid-plan), a channel canvas
(plan-limited, tick-time rewrite churn), bookmarks (static), and pins —
free-plan, event-driven, and API-complete (`pins.add/remove/list`).

## Decision

<a id="pin-lifecycle"></a>**The mayor pins an event root when it posts it,
and unpins it when ground truth says the event no longer waits on a human** —
re-derived each tick (LLP 0002), never remembered: a `ready-to-merge` root
unpins when the PR leaves the open set (or re-enters work), `stuck` when the
label clears or the head moves, `unhealed` when the session's transcript is
fresh again, `fix-queued` when the issue closes or leaves `neutral:fix`,
`issue-stuck` when the fix state leaves `stuck`. The invariant is
reconciler-shaped: **pinned set ≡ events currently waiting on a human.** The
📌 header list is thereby the live queue; a pin the mayor did not make is a
human's own and is never removed. Slack caps pins at 100 per channel — far
above a healthy waiting set; overflow just degrades new events to unpinned
roots, logged.

> **Extended-by [LLP 0049](0049-minimal-artifact-cards.decision.md):** the
> pin is artifact-grained — one root per PR/issue/session, reused across
> recurrences; the invariant (pinned set ≡ waiting on a human) is unchanged.

<a id="pin-dedupe"></a>**`pins.list` becomes the first dedupe read**, ahead
of LLP 0042 §dedupe's bounded history scan (kept as the fallback and for
resolved-and-unpinned keys): pins do not age out of free-plan retention, so
a still-waiting event stays deduped past the 90-day window — the "accepted
periodic nag" now applies only to events that resolved and later recur.

- Scopes: the bot gains `pins:read` + `pins:write` (manifest change, CLI
  reinstall). Pinning is annotation, reversible by one click — it does not
  touch LLP 0041 §no-irreversible.

## Consequences

- Mayor skill: push step pins after posting; a resolution sweep unpins from
  re-derived state each tick; dedupe reads pins first.
- LLP 0042 §dedupe gains an `Extended-by: 0044` forward-ref.
- No bridge or entrypoint change.
