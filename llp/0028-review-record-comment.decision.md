# LLP 0028: The review record is a marker-signed comment, not a body marker

**Type:** Decision
**Status:** Accepted
**Systems:** Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-07
**Related:** 0002, 0009, 0017, 0026, 0027, 0029

## Context

The reviewed rung (LLP 0009 rung 3) records a completed review as a
`<!-- neutral-review: <headSHA> -->` marker in the PR **body**. The review
*comment* — the findings, the verdict, the thing a human actually reads — was
never part of the contract: it was a side effect of the `dual-review` skill, and
once the fan-out redesign stopped invoking that skill verbatim, whether a comment
got posted became each worker's improvisation. Ground truth showed the drift:
review rounds recorded with no comment for the round (hypaware#248 — two markers,
one after-the-fact summary), fix commits appearing on PRs with nothing explaining
them, and every improvised review comment **unmarked** — so LLP 0027's
human-reply predicate reads neutral's own reviews as human guidance, which can
falsely unstick a held PR (live on hypaware-server#88).

This is a self-report gap of exactly the kind LLP 0002 forbids: "reviewed"
counted without the review being observable.

## Options considered

1. **Keep the body marker, add "also post a comment" to the skill prose.**
   Unenforced — the same drift that ate the dual-review contract eats this; no
   verifier catches a missing comment.
2. **Verify both artifacts** (body marker ∧ thread comment). Two artifacts that
   can disagree, and the failure mode (marker without comment) still needs a
   repair rung.
3. **Make the comment the record (chosen).** One artifact, human-visible and
   machine-checked: a review that posted no comment did not happen.

## Decision

A review round is recorded as **one comment on the PR**, whose first line is the
head-keyed marker (sibling of `neutral-stuck`, LLP 0026 — the record lives in the
conversation, where the human reads it):

```
<!-- neutral-review: <headSHA reviewed> <verdict> -->
```

followed by the full review: verdict, each finding with severity and evidence,
what was fixed. The reviewed predicate and the round count (`reviewedAtHead`,
`reviewRounds` — `src/prhealth.js`) derive from these comments. **No comment, no
round**: a worker cannot satisfy the rung without leaving the evidence, and
because the comment carries a `<!-- neutral-… -->` marker it can never read as a
human reply (LLP 0027).

**Legacy:** existing body markers are still read (as clean rounds, ordered before
comment records), so heads already reviewed do not re-open. New reviews write
comments only; the body is no longer edited for review state. The `neutral-triage`
and `neutral-verdict` body markers are out of scope here.

The verdict word the marker carries is LLP 0029's decision.

## Consequences

- `reviewRounds` / `reviewedAtHead` gain a `comments` parameter; `selectRung`
  passes the thread it already observes (LLP 0026 added it to `PrObservation` —
  no extra request per tick).
- The reconcile skill's review rung posts the marker-signed comment as the act
  that completes the round, and stops editing the PR body.
- Review comments stop leaking into `guidance` counts and the unstick predicate
  (LLP 0027) — the marker discriminates them.
- In-flight PRs keep their history: body markers remain readable forever.
