# LLP 0010: Execution model — one orchestrator, parallel fan-out per tick

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-25
**Related:** 0000, 0001, 0003, 0008, 0009

## Context

With three reconciler families (LLP 0008) — pipeline, issue-fix, PR-health — the
question is how the runtime drives them. Two framings were considered and rejected
before this one:

- **Umbrella, sequential.** One `/loop`; each tick picks the single
  highest-priority gap and advances it. Simple, but forces a brittle total priority
  order across unrelated invariants (which bug vs which PR vs which design) and
  starves every gap but one per tick — low throughput.
- **Separate loops.** One `/loop` per reconciler (pipeline / fix / PR-health).
  Dissolves the priority order, but multiplies operational surface (N sessions per
  repo) and **revises the load-bearing one-loop-per-repo invariant** — N loops race
  the shared working tree and ref db, safe only if every reconciler is
  worktree-isolated.

Both miss that the runtime **already** fans work out in parallel: the Implementer is
a wave loop — `parallel()` across worktree-isolated agents, then a serial verified
merge (LLP 0003, "Implementation fans out; merge fans in").

## Decision

Generalize the Implementer's fan-out/fan-in from one change set to the **whole
repo**. There is **one orchestrator `/loop` per repo** (the invariant stands,
unrevised). Each tick:

1. **Observe** every gap across all families, from ground truth (LLP 0002).
2. **Fan out** — dispatch all **branch-disjoint** work concurrently as
   worktree-isolated sub-agents / Workflows: implement task T, resolve the conflict
   on PR X, fix CI on PR Y, review PR Z, mint design D, write the fix for issue I.
   Each worker is blind to the others.
3. **Fan in** — the orchestrator performs the serial, verified merges and
   **re-derives "done" from git/the API** before anything counts (LLP 0002). A
   Workflow's report is a hint; the re-derivation is the conclusion.
4. **Return.** The loop re-observes next tick.

**Disjointness key = the target branch / PR.** At most one worker per
`integration/<slug>` (or per PR) per tick — LLP 0003's
*one-merge-flow-per-integration-branch lock*, generalized. Different branches run in
parallel; same-branch work serializes. This is what stops PR-health's base-merge on
`integration/X` racing the Implementer's task-merge on the same branch.

**Priority becomes queue order.** With everything dispatched, priority no longer
selects a single action; it only orders the queue when the Workflow concurrency cap
is hit. The brittle total order across families — the reason this decision exists —
is gone.

## Consequences

- **One-loop-per-repo holds.** Parallelism is intra-tick, via sub-agents; exactly
  one orchestrator touches the repo, so the invariant in LLP 0003 / the reconcile
  skill is unchanged — no separate-loop race surface.
- **Worktrees are self-created.** The Workflow runtime's built-in
  `isolation:'worktree'` fails in this repo (the session predates `git init`), so
  every fan-out worker creates its **own** `git worktree` — as the Implementer
  already does. The execution model depends on this.
- **Throughput scales with independent gaps**, bounded by the Workflow concurrency
  cap; a backlog of unrelated PRs/issues/tasks closes in parallel, not one-per-tick.
- **Supersedes** the umbrella-sequential and separate-loops framings. LLP 0000
  §Runtime is updated: a tick fans out all branch-disjoint gaps; it does not "pick
  the most out-of-state gap and act".
- **Partial failure is normal.** A fan-out worker that fails leaves its gap open;
  the next tick re-observes and re-dispatches (idempotent, LLP 0001).
