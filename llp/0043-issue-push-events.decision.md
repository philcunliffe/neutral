# LLP 0043: Issue-family push events — fix intake and stuck issues notify

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-28
**Related:** 0002, 0009, 0026, 0027, 0041, 0042

## Context

LLP 0041 §push-pull fixed the mayor's push set at three PR/fleet events —
what waits on a human — leaving issues pull-only: a `neutral:fix` issue
surfaced in Slack only once its fix PR hit a PR event. In practice the fix
queue is fed by more hands than the notified human's (other allowlisted
users, repo collaborators labelling issues), so queue entry is news the
human doesn't already have, and a stuck issue waits on a human exactly as a
stuck PR does — it was deferred only because LLP 0026's issue-side report
is deferred.

## Decision

<a id="issue-events"></a>**Two issue push events join the mayor's scan**,
both re-derived from `neutral issues --json` (LLP 0002; state ∈
`needs-fix | attempt-exists | stuck`):

- **Fix intake** — an open `neutral:fix` issue is announced once, when
  first observed. This deliberately widens LLP 0041 §push-pull's
  waits-on-a-human criterion to one *queue-awareness* event: the label may
  not be the notified human's own act.
- **Issue stuck** — an issue whose fix state is `stuck` waits on a human;
  squarely the existing push principle.

<a id="issue-keys"></a>**Keys, same mechanism as LLP 0042
§notification-key** (first line of the root message, deduped by bounded
history scan):

```
[neutral <owner/repo>#<issue> fix-queued]
[neutral <owner/repo>#<issue> issue-stuck]
```

No `@<suffix>` — an issue has no head SHA; the events are once-per-issue
within the history window, and a re-announcement past the window remains
the accepted periodic nag. `issue-stuck` (not `stuck`) keeps issue keys
disjoint from PR keys, since issues and PRs share GitHub's number space.

> **Extended-by [LLP 0049](0049-minimal-artifact-cards.decision.md):** these
> keys now live on thread detail replies; the root carries a state-free
> artifact key, and `fix-queued`/`issue-stuck` render as the card's status.

<a id="issue-reply-relay"></a>**A thread reply under an issue root relays
as an issue comment** — verbatim, unmarked, `— relayed from Slack` footer:
the LLP 0041 §identity-principle applies to authorship regardless of
target. What it does *not* do is unstick: LLP 0027's comment-unstick is
PR-scoped, and the issue-side stuck report/baseline (LLP 0026) stays
deferred — the relay delivers words to the thread a human or the next fix
attempt will read, and the mayor's confirmation says exactly that.

## Consequences

- The mayor skill's push scan gains the issue events; no bridge or
  entrypoint change (the transport and dedupe are unchanged).
- LLP 0041 §push-pull and LLP 0042 §notification-key gain
  `Extended-by: 0043` forward-refs.
- If the issue-side stuck report lands later (LLP 0026's deferral), the
  `issue-stuck` key SHOULD gain the report's baseline as its suffix in a
  new request doc — re-sticks would then notify afresh, as PR re-sticks do.
