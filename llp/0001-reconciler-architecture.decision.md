# LLP 0001: Declarative reconcilers over imperative formulas

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-23
**Related:** 0000, 0002, 0003

## Context

The predecessor automation (`/feature-flow` and the `gastown`/`pr-pipeline`
formula packs) drove work imperatively: a launch step created beads, a refinery
patrol merged them, a review formula reviewed PRs. It delivered, but the
`testcity` memory bank records a recurring failure class:

- **Fabricated merge** — the refinery recorded `merge_result=merged` with a
  non-existent SHA and closed the bead without merging; the false close
  unblocked the next bead onto a base missing the prior bead's code.
- **Fabricated verdict** — when a review sub-step failed, an inline fallback
  branch invented a verdict rather than failing loudly.
- **Non-idempotent recovery** — `mol-feature-review` re-ran its review step on
  every recovery, discarding the completed verdict from the prior attempt.
- **Stale-state races** — concurrent agents self-healed between observation and
  action, causing duplicate work.

The common root: **state was self-reported, and control logic lived in
ambiguous prose.** "Formula prose IS the agent's instructions" — ambiguity
produced multi-execution and fabricated results.

## Options considered

1. **Harden the imperative formulas.** Add verification gates and idempotency
   keys to each formula step. Lower lift, but the model still centers on
   self-reported status that *can* drift; every new step is a new place to
   fabricate.
2. **Declarative reconcilers (chosen).** Model each stage as a controller with a
   desired-state invariant, reconciled from observed ground truth. Control flow
   lives in deterministic code; the agent's job shrinks to a small, crisp,
   verifiable action.

## Decision

Adopt the **declarative reconciler** model. Each stage:

- **Observes** the world from ground truth (LLP files, design files + `@ref`,
  git branches, `gh` PR state, the commit graph) — freshly, immediately before
  acting.
- **Diffs** observed state against its base-state invariant to find the gap.
- **Acts** to close the gap with an idempotent, single-purpose operation.
- **Verifies** the result against ground truth before it counts as done.

The deterministic **Engine** owns all control flow (what's covered, what's
ready, what's merged, which reconciler runs). Agents are dispatched only for the
creative/heavy work (writing a design, implementing a task, reviewing a PR), and
their outputs are always re-checked against the world.

## Consequences

- **The fabrication class disappears.** A reconciler cannot "claim done" — done
  is `git merge-base --is-ancestor`, a real `@ref`, an open PR `gh` reports.
  See [LLP 0002](0002-ground-truth.principle.md).
- **Idempotency is free.** Re-running a reconcile pass observes the same world
  and closes whatever gap remains; completed work is detected, not redone. The
  `mol-feature-review` recovery bug is structurally impossible.
- **Stale-state races shrink.** Each pass reads fresh state right before acting,
  and "already done" is observable, so duplicate work is detected on the next
  observe.
- **No task database.** State is derived, so there is nothing to keep in sync or
  to corrupt. The ready-queue is a pure function of (task file, git state) — see
  [LLP 0003](0003-coverage-and-change-sets.spec.md).
- **Cost:** the Engine must implement observation and the coverage/ready
  computations itself (it does not get a tracker's query surface for free), and
  every stage needs a mechanical verification predicate. This is the point, not
  a regression: the predicate is the thing that makes the result trustworthy.
