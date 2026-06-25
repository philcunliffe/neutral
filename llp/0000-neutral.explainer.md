# LLP 0000: Neutral

**Type:** Explainer
**Status:** Active
**Systems:** Core
**Role:** Root
**Author:** Phil
**Date:** 2026-06-23
**Related:** 0001, 0002, 0003, 0008, 0010

## Summary

Neutral is a set of **declarative reconcilers** that take LLPs which have left
Draft and drive them, together, through technical design → implementation design
→ task fan-out → integration PR → review → fix, converging a repository toward
**neutral state** — the resting point where every gap neutral can close
*autonomously* is closed: no uncovered request LLP, no `neutral:fix` issue without
a fix attempt, no in-scope PR left unmergeable, failing, or unreviewed (see
[LLP 0008](0008-neutral-state-and-reconciler-families.decision.md)). Each
reconciler holds an invariant and closes the gap from **observed git/GitHub ground
truth**, never a self-reported ledger. The system is the Kubernetes-controller
pattern applied across two reconciler families — the LLP→PR **pipeline** and
PR/issue **maintenance**.

## Motivation

The predecessor pipeline (`/feature-flow`) was a set of imperative formulas
(`/feature-launch`, `mol-feature-refinery-patrol`, `mol-feature-review`, …).
It shipped real work, but every hard-won failure had the same shape: an agent
**fabricating a result** under ambiguous prose — a refinery recording
`merge_result=merged` with a non-existent SHA, a review verdict invented when a
sub-step failed, a recovery cycle discarding a completed dual-review. The lesson
(captured across the `testcity` memory bank) is that *self-reported state under
imperative prose drifts from reality*. Neutral removes the class of bug by
construction: state is **derived**, and every claim is **verified against ground
truth** before it counts.

## The reconcilers

Each reconciler holds a base-state invariant; a "gap" is any place the observed
world violates it. They fall into two **families** (LLP 0008) over one shared
PR-health spine.

**Pipeline family** — intake is a request LLP, output an integration PR:

| Reconciler | System | Base state (invariant) |
|---|---|---|
| **Designer** | `Designer` | every live request LLP is `@ref`'d by a design LLP |
| **Impl-designer** | `Designer` | every `design` LLP has an implementation `plan` LLP |
| **Implementer** | `Engineer` | every task is a verified-merged commit on its integration branch, and the change set has an open PR |

**Maintenance family** — intake is a GitHub artifact a human labelled (LLP 0009):

| Reconciler | System | Base state (invariant) |
|---|---|---|
| **Issue-fix** | `Engineer` | every `neutral:fix` issue has a fix attempt (a `Fixes #N` PR, or `neutral:stuck`) |

**Shared spine** — `reconcilePR`, over every in-scope open PR (integration or fix):

| Reconciler | System | Base state (invariant) |
|---|---|---|
| **PR-health** | `Engineer`, `Reviewer` | mergeable ∧ green ∧ reviewed, then held for a human |

## Key concepts

### Coverage, not bijection

LLPs are often written together and only implementable together. So the Designer
invariant is **coverage**: every live *request* LLP must be *referenced by* a
design — not "every LLP gets its own design". Designs are LLPs too (the `type`
field marks each doc's role — request / design / background), and a design LLP
`@ref`s the set of request LLPs it covers. The inverse of `ref-check` — "which
request has no incoming `@ref`?" — is the Designer's backlog. See
[LLP 0003](0003-coverage-and-change-sets.spec.md).

### The Designer is a planner

When uncovered requests exist, the Designer chooses **which** to implement
together and **in what order**. Its output is a set of **`design` LLPs** (one per
change set), each `@ref`ing its grouped requests, with `Depends-on:` edges that
form a DAG. Ordering gates downstream: a change set's implementation does not
start until its predecessors are merged.

### Change sets flow as a unit

A change set is a `design` LLP plus its implementation `plan` LLP, and it carries
its covered requests through the pipeline as one unit: one task breakdown (in the
plan), one integration branch (`integration/<design-slug>`), one PR —
implementing all its requests together. There is no `.llp-flow` directory; the
design and plan live in the corpus and all runtime state is git.

### Ground truth, never self-report

Every "is this done?" question is answered by re-deriving the fact from the
world: a task is merged only when its branch is a verified ancestor of the
integration branch; coverage is a real `@ref`. See [LLP 0002](0002-ground-truth.principle.md).

## Runtime

The prototype runtime is a **Claude `/loop` + Workflows**:

- **Observe** — the deterministic Node core (`neutral status --json`,
  `neutral ready <cs>`) is the loop's eyes; it contains no LLM logic and trusts
  only git/files.
- **Control loop** — a single Claude `/loop` session per repo (one orchestrator;
  the one-loop-per-repo invariant intact): each tick observes every gap, **fans out
  all branch-disjoint work in parallel** as worktree-isolated sub-agents/Workflows,
  then **fans in** serial verified merges and re-derives "done" from ground truth.
  Self-paced between ticks. See [LLP 0010](0010-execution-model.decision.md).
- **Single-shot work** (Designer, Impl-designer) — minting a `design` / `plan` LLP
  is one fan-out worker among the rest (or done inline for a lone gap).
- **Fan-out / fan-in** — the model for the whole tick (LLP 0010), realized with
  Claude **Workflows**: e.g. the Implementer wave loop (`parallel()` impl in
  **self-created** worktrees, then a serial verified merge), and `reconcilePR`'s
  heal/review work. The review rung is `/dual-review` (Codex + Claude + per-finding
  verification).
- **git** is the only source of "done".

The standalone Node engine + headless `claude -p` workers (and tmux for a
persistent fleet) are the **productionization** path once the prototype proves
the loop — not needed to validate it.

## Autonomy

The pipeline auto-converges through the bounded review/fix loop, then **holds**:
the change-set PR is flipped ready-for-human-merge and never auto-merged. The
human's merge is the one irreversible act, and (via the DAG) it unblocks
dependent change sets.

## Systems map

- `Core` — shared vocabulary (this document, the invariants, ground-truth rule).
- `Engine` — observation, coverage check, ready-queue, `status`, dispatch.
- `Designer` — Designer + Impl-designer reconcilers.
- `Engineer` — code-writing and -repairing reconcilers: the wave-loop Implementer
  (pipeline), Issue-fix, and the heal rungs of PR-health (LLP 0008/0009).
- `Reviewer` — dual-review integration + fix loop; the review rung of PR-health.

## References

- [LLP 0001](0001-reconciler-architecture.decision.md) — reconcilers over formulas
- [LLP 0002](0002-ground-truth.principle.md) — ground truth, never self-report
- [LLP 0003](0003-coverage-and-change-sets.spec.md) — coverage, change sets, ready-queue
