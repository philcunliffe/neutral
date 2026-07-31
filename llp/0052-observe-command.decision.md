# LLP 0052: One observe command reports every gap

**Type:** Decision
**Status:** Active
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0002, 0003, 0009, 0013, 0016, 0051

## Context

The tick's observation step was spread across four commands plus two checks that
had **no command at all**. `neutral backlog`, `neutral implementable`,
`neutral prs` and `neutral issues` each report their own gap family, but two
pipeline gaps were left to skill prose:

- *a change set with a plan but unmerged tasks* — findable only by enumerating
  `origin/integration/*` by hand and running `neutral ready <slug>` per branch,
  from a worktree of that branch (the working-tree read fails on the main
  checkout);
- *a change set whose tasks are all merged but that has no PR* — findable only
  by cross-referencing the branch list against `neutral prs`.

A planned-but-unstarted change set emits **zero signal** through every command:
backlog and implementable are correctly empty, no PR exists yet, no issue is
involved. A production run (hyparam/hypaware, `openclaw-full-capture`,
2026-07-31) sat in exactly that state for five consecutive ticks (~3.5 h) while
every tick found visible maintenance work, did it, and reported itself complete.
Implementation started only when a human asked why nothing had happened. The
idle predicate shared the blind spot: with maintenance drained, such a tick
would have read **idle** and recycled with unblocked work pending.

## Decision

Add **`neutral observe`** — one command that assembles the complete gap report
across both families, and make the idle predicate consume the same change-set
observation.

### Single observe surface

`neutral observe [--json]` reports, in one invocation: the Designer backlog,
the implementable designs, **every `integration/*` change set with its
ready/blocked/done queues**, the in-scope PRs with their rung actions, and the
`neutral:fix` issues. Exit 0 ⇔ no gap (neutral state); exit 1 ⇔ gaps remain.
The per-family commands stay — they are the composable parts — but the tick's
observation step is one command, so a gap family cannot be skipped by prose.

### Change-set gaps from refs

The new change-set observation enumerates `integration/*` branches itself and
reads each plan LLP **from the branch's git blob** (`git show ref:path`), the
same ground-truth move as LLP 0016's design-first intake — no worktree, no
main-checkout dependency. Each change set classifies to one action:

- `plan` — no parseable plan LLP with a `## Tasks` block on the branch
  (the Impl-designer gap);
- `implement` — unblocked tasks exist (done-set per LLP 0033/0051);
- `create-pr` — every task merged, no open PR for the integration branch;
- `null` — nothing owed: tasks all blocked on in-flight work, an open PR
  already carries it (the maintenance family drives it), or the design is
  Active on target (shipped, LLP 0016).

### Idle extension

`idleState` gains the change-set observation as a fourth input: any change set
with a non-null action blocks idle, exactly as an uncovered request or a
non-`held` PR does. Idle remains "no gaps across the families" (LLP 0013) —
this closes the family the predicate could not see.

## Alternatives rejected

- **Keep per-gap commands + skill discipline.** That is the status quo that
  failed in production: the check with no command was the check that got
  skipped. Observation completeness must be mechanical, not remembered.
- **A worktree-based sweep in skill prose** (enumerate branches, `neutral
  ready` each from a temp worktree). Works, but stays manual, slow, and
  invisible to the idle predicate; the loop's own memory shows it being
  rediscovered instead of relied on.

## Consequences

- The reconcile skill's observation step collapses to `neutral observe --json`.
- `neutral ready <slug>` remains the deep view of one change set; observe is
  the sweep that says which slugs to look at.
- An integration branch that outlives its merged rollup PR reads `null`
  (shipped) — branch cleanup stays a human call.
