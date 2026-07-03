# LLP 0003: Coverage, designs, and the ready-queue

**Type:** Spec
**Status:** Accepted
**Systems:** Engine
**Author:** Phil
**Date:** 2026-06-23
**Related:** 0000, 0001, 0002
**Extended-by:** LLP 0016 — design-first intake (an Accepted design merged to target is a build order; shipped ⇔ Active, not mere presence)

## Summary

Everything in the pipeline is an LLP — there are no separate design-document
formats. This spec defines the role each LLP `type` plays, the **coverage**
invariant, how **designs** are represented as LLPs, and the git-derived
**ready-queue**.

## Types and roles

An LLP's `type` carries its **role** in the flow, not a worthiness judgment:

| Role | Types | In the flow |
|---|---|---|
| **request** | `spec`, `rfc`, `issue` | wants building — *needs* coverage |
| **design** | `design` (technical), `plan` (implementation) | the plan — *provides* coverage, never needs its own |
| **background** | `explainer`, `principle`, `decision`, `guide`, `research` | context — not built, but a design may `@ref` it as a constraint |

The sets live in `src/llp.js` (`REQUEST_TYPES`, `DESIGN_TYPES`). `design` is a
project-local type (LLP permits custom types); `plan` is standard. Splitting
request vs design by type is what stops a design from needing its own design —
no infinite regress.

## Design-eligible LLPs (the backlog)

An LLP **needs coverage** when it is a request type AND has left Draft into a
live status (`LIVE_STATUSES = { Accepted, Active }`). `Draft` is not ready;
`Review` is excluded by decision; `Superseded`/`Tombstoned` are retired.

## Coverage invariant

The Designer's base state: **every live request LLP is `@ref`'d by a design LLP
(planned) or by code (already realized).**

```
covered   = request LLPs @ref'd by a design LLP OR by source code
uncovered = live requests covered by neither            <- the Designer backlog
```

A design LLP declares what it covers with `@ref LLP NNNN — gloss` annotations.
Coverage is read from real annotations (the inverse of `ref-check`), never a
flag — consistent with [LLP 0002](0002-ground-truth.principle.md). A request
already realized in code (an incoming `@ref` from `src/`/`bin/`/`test/`) is
covered without a design — this is how bootstrap-built specs drop out of the
backlog.

## Designs are LLPs

The Designer mints a **`design`** LLP (via `llp-create`): it `@ref`s the request
LLPs it groups together and uses `Related:` / a `**Depends-on:**` header to
record ordering against other designs — the change-set **DAG**. The
Impl-designer mints a **`plan`** LLP `Related:` to the design, refining it into
tasks. Both carry `**Generated-by:** neutral` so humans can tell minted docs
from hand-authored ones.

Because designs are LLPs, the toolchain applies for free: `llp-create` mints
them, `llp-list` surveys them, `llp-review` reviews them, `ref-check` validates
their `@ref`s, and they get a `Draft -> Review -> Accepted -> Active` lifecycle.

## The change set

A **change set** is a `design` LLP plus its `plan` LLP and their git artifacts:
one integration branch `integration/<design-slug>`, one PR into the target
(default `main`). There is no `.llp-flow` directory — the design and plan live
in the corpus; all runtime state (branches, PRs, merges, task completion) is git
ground truth. A change set is *blocked* until every change set named in its
`Depends-on:` is merged to the target.

## Tasks

The task breakdown lives in the `plan` LLP as a block the Engine parses:

```
## Tasks
- id: T1  branch: task/<slug>/T1  deps: []        -- brief
- id: T2  branch: task/<slug>/T2  deps: [T1]      -- brief
```

`id` is unique within the change set; `deps` are task ids; `branch` merges into
the change set's integration branch.

Extended-by: 0022 — the task line may carry an optional `complexity: 1–5`
rating (the model-tier seed for the first attempt).

## Ready-queue (the unblocked-open list)

The git-native `bd ready`, split into a declared part and a derived part:

- **declared** — dependency edges, from the `plan` LLP's task block.
- **derived** — a task is **done** iff its branch is a verified ancestor of the
  integration branch: `git merge-base --is-ancestor <branch> integration/<slug>`.
  Task→integration merges are `--no-ff` (real merge commits) so this ancestry
  holds; a squash merge would discard parentage and break the predicate, so squash
  is used **only** at the final `integration/<slug> → target` PR.

```
done(t)  = branch(t) is a verified ancestor of the integration branch
ready    = { t : not done(t) and deps(t) subset of done }
blocked  = { t : not done(t) and deps(t) not subset of done }
```

`ready` is a pure function of (the plan's tasks, git state). No task database to
drift or fabricate.

## The wave loop (Implementer)

Implementation fans **out**; merge fans **in**. **One Claude Workflow per change
set** owns the wave loop in its (pure-JS) control flow — the loop is deterministic
code, not skill prose. Each wave:

1. A `derive-ready` agent shells `neutral ready <slug> --json` (git truth; the
   Workflow script itself cannot run git).
2. **Implement** the ready wave in parallel, one agent per task in its own worktree
   (`isolation: 'worktree'`), off the current integration HEAD. Dispatch is
   idempotent against an existing `task/<slug>/<id>` branch (reset + continue,
   reuse the PR) — never force-recreate.
3. **Merge** the wave with a **single** serial agent, in `topoOrder`, `--no-ff`,
   verifying each merge three ways before it counts (object exists / `--is-ancestor`
   / per-touched-file content) and aborting on the first failure.
4. Repeat until `ready` is empty or stops shrinking (→ report stuck).

After the Workflow returns, the **skill re-verifies every merge from git** — the
Workflow's claims are hints; the git re-derivation is the conclusion. `git worktree
prune` runs at Workflow start; a one-merge-flow-per-integration-branch lock keeps
two waves from racing. Waves (not one big fan-out) ensure a task needing a
predecessor's code branches off the integration HEAD after that predecessor merged.
