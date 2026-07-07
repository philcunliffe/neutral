# LLP 0026: The stuck report — a stuck PR carries a full, marker-signed situation comment

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-07
**Related:** 0000, 0002, 0009, 0017, 0018, 0027

## Context

`neutral:stuck` is where autonomy ends: neutral hit something it will not guess at
(a review blocker, a conflict it backed off, a design fork) and a human must look.
But what the human *finds* today is only a label plus whatever ad-hoc prose the
sticking worker happened to leave — the skill says "comment why", nothing enforces
it, nothing structures it, and a PR stuck by a crashed worker (or labelled by hand)
may carry no explanation at all. The label says *stop*; nothing reliably says *why*,
*what is needed*, or *how to respond*. And because nothing machine-recognisable
marks the moment of sticking, there is no baseline against which a later human
response could even be detected (the gap LLP 0027 closes).

## Options considered

1. **Keep ad-hoc prose.** Free, but unenforced (a crash or a manual label leaves a
   bare label) and unrecognisable to the reconciler — no baseline for LLP 0027.
2. **Record the situation in the PR body**, like the review/triage markers. But the
   body is a document, not a conversation: the human's response channel is the
   comment thread, so the report belongs there — adjacent to where the reply will
   land, and timestamped in the same stream.
3. **A marker-signed report comment, reconciled like any other invariant (chosen).**

## Decision

A PR labelled `neutral:stuck` must carry a **stuck report**: one full comment,
signed with a head-keyed marker, posted **by the same act that sets the label**.
The report is itself an invariant `reconcilePR` holds — a labelled PR whose thread
has no report gets the new rung action **`stuck-report`**, which posts it. Partial
failure self-heals (label landed, comment didn't → next tick posts the report), and
already-stuck PRs from before this decision gain a report on the next tick.

**The marker** — first line of the comment, sibling of `neutral-review` /
`neutral-triage` but living in a *comment* (the conversation), not the body:

```
<!-- neutral-stuck: <headSHA at stick time> -->
```

Because neutral posts through the repo owner's own `gh` authentication, author
identity cannot distinguish neutral's comments from the human's — **the marker is
the discriminator**, which is why every comment neutral posts must carry a
`<!-- neutral-… -->` marker (LLP 0027 keys "human reply" on its absence).

**The report body** — written for the human who has to act, not for the log:

- **What neutral was doing** — the rung/action, the change set or issue, the head.
- **Why it cannot proceed** — the specific blocker(s): each unresolved review
  finding, the conflict it backed off, the decision fork — with links.
- **What it needs from you** — the concrete question(s), with options where they
  exist.
- **How to unstick** — reply with a comment on this PR (or push to the branch);
  neutral monitors the thread and re-engages with the guidance (LLP 0027).

A *re*-stick (neutral re-engaged per LLP 0027 and got stuck again, even at the same
head) posts a **new** report — the latest report is the baseline the LLP 0027
predicate reads against, so it must postdate the human comments already consumed.

## Consequences

- `RungDecision` gains the action `stuck-report`; `selectRung`'s stuck
  short-circuit emits it when the label is present but no report comment exists.
- `PrObservation` gains `comments` (author, body, createdAt), observed by the same
  `gh pr view --json` call — no extra request per tick.
- The report is not idle: `stuck-report` ≠ `held`, so a bare-labelled PR blocks
  idle for exactly the one tick it takes to post the report.
- Every path that sets `neutral:stuck` (triage blockers, conflict back-off, wave-loop
  exhaustion, unproven issue fix) now posts the report in the same act; the
  `stuck-report` rung is the safety net, not the norm.
- Issues labelled `neutral:stuck` are **deferred**: the same shape applies, but the
  ask (and the monitoring loop, LLP 0027) is PR-scoped today.
