# LLP 0029: Review records carry a verdict — a blocked round still counts

**Type:** Decision
**Status:** Accepted
**Systems:** Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-07
**Related:** 0002, 0009, 0017, 0028

## Context

The review marker was only written after a round *succeeded* — reviewed clean, or
findings fixed (head moves, marker records the old head). A round whose findings
could **not** be fixed left no marker at all: the head stayed unreviewed, the
round was never counted, and `maxReviewRounds` (LLP 0009/0017) never tripped. The
loop re-reviewed the same head every tick, forever — observed live on
hypaware-server#94: two identical `block` reviews of one head, 23 minutes apart,
zero markers.

The cap exists to bound the fix loop; a bound that only counts successes cannot
bound failures.

## Options considered

1. **Mark the head reviewed even on a blocked round.** Falsely terminal — a PR
   with unresolved blockers would flip ready-hold (or merge, under LLP 0019).
2. **A separate "attempts" counter** (label, body field). A second artifact with
   its own drift; and a self-reported tally is what LLP 0002 exists to prevent.
3. **The record carries the verdict (chosen).** One record per round regardless of
   outcome; the verdict decides whether it *satisfies* the rung, the count decides
   the cap.

## Decision

The review-record marker (a comment, LLP 0028) carries a verdict word:

```
<!-- neutral-review: <headSHA> clean -->      the review found nothing actionable
<!-- neutral-review: <headSHA> findings -->   it found actionable findings
```

- **Reviewed** (`reviewedAtHead`): the *latest* record covers the current head
  **and** is `clean`. A `findings` record at the head is a counted, unsatisfied
  round; a record for an older head is stale either way (LLP 0002).
- **Rounds** (`reviewRounds`): every record counts, `clean` or `findings`, fixed
  or blocked. At the cap the rung hands off to triage (LLP 0017) as before.
- A bare marker with no verdict word reads as `clean` — that is exactly the
  legacy body-marker semantics (a body marker was only ever written on success),
  so old records need no rewrite.

A worker that fixed its findings does not need a special verdict: the fixes move
the head, the `findings` record goes stale, and the next tick reviews the new
head as round N+1 — unchanged from the body-marker flow.

## Consequences

- The infinite re-review of an unfixable head ends at the cap: two `findings`
  records at the same head → `triage` → deferred follow-up or `neutral:stuck`
  with a stuck report (LLP 0026).
- `parseReviewMarkers` returns `{sha, clean}` records, not bare SHAs.
- The reconcile skill instructs workers to post the record **whatever the
  outcome** — the comment is the round (LLP 0028), success is a separate fact the
  SHA comparison derives.
