# LLP 0000: Neutral

**Type:** Explainer
**Status:** Active
**Systems:** Core
**Role:** Root
**Author:** Phil
**Date:** 2026-06-23
**Related:** 0001, 0002, 0003

## Summary

Neutral is a set of **declarative reconcilers** that take LLPs which have left
Draft and drive them, together, through technical design → implementation design
→ task fan-out → integration PR → review → fix, converging a repository toward a
desired **base state**. Each reconciler holds an invariant and closes the gap
from **observed git/file ground truth**, never a self-reported ledger. The whole
system is the Kubernetes-controller pattern applied to the LLP → PR pipeline.

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

## The pipeline

Five reconcilers, each with a base-state invariant. A "gap" is any place the
observed world violates the invariant; reconciling closes it.

| Reconciler | System | Base state (invariant) |
|---|---|---|
| **Designer** | `Designer` | every live request LLP is `@ref`'d by a design LLP |
| **Impl-designer** | `Designer` | every `design` LLP has an implementation `plan` LLP |
| **Implementer** | `Implementer` | every task is a verified-merged commit on its integration branch |
| **PR** | `Implementer` | every change set has an open integration PR |
| **Reviewer** | `Reviewer` | every integration PR has a passing review (or is held for a human) |

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
- **Control loop** — a Claude `/loop` session: each tick observes, picks the
  most out-of-state gap, and acts. Self-paced between ticks.
- **Single-shot stages** (Designer, Impl-designer) — the loop mints the `design`
  / `plan` LLP inline (or via a subagent).
- **Fan-out stages** — Claude **Workflows**: the Implementer is a wave loop
  (`parallel()` impl in isolated worktrees, then a **serial, verified** merge —
  fan-out then fan-*in*); the Reviewer is `/dual-review` (Codex + Claude +
  per-finding verification).
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
- `Implementer` — wave loop, merge serialization, PR.
- `Reviewer` — dual-review integration + fix loop.

## References

- [LLP 0001](0001-reconciler-architecture.decision.md) — reconcilers over formulas
- [LLP 0002](0002-ground-truth.principle.md) — ground truth, never self-report
- [LLP 0003](0003-coverage-and-change-sets.spec.md) — coverage, change sets, ready-queue
