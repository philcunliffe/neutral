# LLP 0012: The orchestrator never requires a clean main checkout

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-25
**Related:** 0002, 0003, 0008, 0010, 0011

## Context

LLP 0010 established **self-created worktrees** for fan-out workers, but only for
the *parallel code-mutating* ones. Several operations were quietly exempted and run
**in the main checkout**:

- The **queue read** (`implement-changeset.workflow.js` `DERIVE_READY`) does
  `git switch <integration>` — because `neutral ready` reads the plan LLP from the
  **working tree** (`src/commands/ready.js` → `readLlps` + `readFileSync`), not a ref.
- The **serial merger** works "directly in this repo checkout … do NOT create a
  worktree" on the integration branch.
- The **mechanical `merge-base` rung**, the **Designer**, and the **Impl-designer**
  all `git switch` the main checkout to mint or advance branches.
- The **review** (`dual-review`) does `gh pr checkout --detach` *in place* and
  **refuses on a dirty tree** (`status=blocked` if `git status --porcelain` is
  non-empty).

Observed failure: when the main checkout has active changes — a human editing the
same repo, or the orchestrator parked on an `integration/*` branch — these in-place
operations fail (`git switch` refuses) or report `blocked` (dual-review). A change
set stalls, and the symptom *looks like* a dependency block but is not; the
`Depends-on` DAG is fine. The real, unstated precondition was "the main checkout is
clean and on no managed branch."

Two framings were rejected:

- **Require the human to keep the main checkout clean.** Re-introduces the coupling
  as a rule, and defeats the ergonomics of one-loop-per-repo (you cannot edit the
  repo while the loop runs).
- **Run the orchestrator in a dedicated clone.** Decouples fully, but adds another
  working copy and a sync surface — operational weight the worktree model already
  avoids for workers.

## Decision

The orchestrator treats the **main checkout as read-only and off-limits**. *Every*
git mutation — parallel **or serial** — happens in a self-created worktree, the same
way LLP 0010's workers already do.

- **Detached is the default for orchestrator worktrees.** The queue read and the
  serial merger run `git worktree add --detach "$WT" origin/<integration>`: they
  operate on the *commit*, and the merger pushes via `git push origin HEAD:<integration>`.
  Nothing checks out a managed branch, so the "two worktrees cannot share a branch"
  constraint never bites — regardless of where the main checkout is parked.
- The **`merge-base` rung**, the **Designer**, and the **Impl-designer** likewise
  work in worktrees (`git worktree add … -b <new-branch> origin/<base>` to mint;
  detached to advance), never `git switch` on the main checkout.
- The **review worker** runs in its own worktree, so `dual-review`'s in-place
  detached checkout and its clean-tree guard act on a *fresh, clean* tree — never the
  human's edits.

A **dirty main working tree is therefore harmless, not forbidden** — a human can keep
working in the repo while the loop runs. The orchestrator never inspects working-tree
cleanliness; the only per-tick hygiene is `git worktree prune` to reap leaked
worktrees (LLP 0011).

## Consequences

- **One-loop-per-repo (LLP 0010) is unchanged** — this removes a *hidden
  precondition* (clean main checkout), it does not add a loop or a clone.
- **`neutral ready` stays working-tree-based** (`src/commands/ready.js`) and needs no
  change: it now runs inside a worktree that has the integration branch's tree. A
  future option — make `neutral ready` ref-aware (read the plan via `git show
  <ref>:<path>`, as `changeSetMergedToTarget`/`showFile` already do) so even the
  worktree is unnecessary — is **deferred** as unneeded scope.
- **Branch-checkout conflicts are structurally impossible**: orchestrator ops are
  detached; workers only ever create *fresh* `task/*` and new `integration/*`
  branches, which are never checked out elsewhere.
- **Worktree churn rises slightly** (the read and the merge each add/remove a
  worktree). It is bounded by the per-tick concurrency cap and reaped by
  `git worktree prune` — the same loose end LLP 0011 (autophagy) already owns.
- **Supersedes the implicit exemption in LLP 0010 §Consequences** ("worktrees are
  self-created") by extending it from the parallel workers to *all* orchestrator git
  mutations. The SKILL invariant gains: *the orchestrator never touches the main
  checkout.*
