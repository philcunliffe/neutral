---
name: neutral-reconcile
description: Run one reconcile tick of neutral — observe git/GitHub ground truth across both reconciler families (LLP→PR pipeline + PR/issue maintenance), fan out every branch-disjoint gap in parallel, fan in serial verified merges, and re-derive "done" from git. Holds every result for a human; never merges. Idempotent and safe to re-run. Use when running `/loop /neutral-reconcile` to drive a repo toward neutral state, or to run one tick by hand.
allowed-tools: Bash, Read, Write, Edit, Agent, Skill, Workflow
---

# neutral-reconcile

One **tick** of the neutral reconciler. A tick observes ground truth across every
reconciler family, **fans out all branch-disjoint gaps in parallel**, **fans in**
serial verified merges, re-derives "done" from git/GitHub, and returns. Re-running
is always safe — state is derived, not stored. Driven by `/loop /neutral-reconcile`.

The goal is **neutral state** (LLP 0008): every gap neutral can close *autonomously*
is closed — no uncovered request LLP, no `neutral:fix` issue without a fix attempt,
no in-scope PR left unmergeable / failing / unreviewed. Neutral stops at the
boundary of what only a human may do: **merging is the one act neutral never
performs.** It drives every artifact to *held, green, reviewed* and waits.

## The one rule — ground truth, never self-report (LLP 0002)

**Never trust a claim of "done" — re-derive it from the world.** The independent
observer's verdict re-read fresh is authoritative; the acting agent's prose is only
a *hint to verify*:

- **Merged?** `git merge-base --is-ancestor <branch> <integration>` — a verified ancestor.
- **Covered?** a real `@ref LLP NNNN` in a design (or code), not a "designed" flag.
- **Mergeable? / Green?** GitHub's *own* computation, read against the **current head
  SHA** (`gh pr view --json mergeable,statusCheckRollup`). A green check from a prior
  push is **stale** and does not count.
- **Bug fixed?** a regression test that **failed** pre-fix now **passes** in the
  committed tree (CI green on the fix PR is the authority, not the agent's local run).
- **Not yet observable ≠ false.** A `PENDING` check or `UNKNOWN` mergeability means
  **wait for the next tick**, never "broken" — acting on it storms work that was
  about to pass.

The deterministic Node CLI (`neutral …`) and git/`gh` are the authority; agents do
work, the tick verifies it.

## Each tick

1. **Fetch + prune.** `git fetch --prune` (without it a teammate's push and the
   human's merge are invisible and the loop looks wedged), then `git worktree prune`
   to reap worktrees a failed worker left behind. **The main checkout is read-only**
   — every git mutation this tick happens in a self-created worktree (LLP 0012), so a
   dirty working tree or a human editing the repo never blocks the loop.
2. **Observe every gap** (the loop's eyes — all CLI, no LLM judgement):
   - **Pipeline family**
     - `neutral backlog --json` → live requests needing a design (Designer).
     - neutral-minted `design` LLPs (`**Generated-by:** neutral`) without a `plan`
       (Impl-designer) — read each `integration/*` branch's LLPs.
     - change sets with a `plan` but unmerged tasks (`neutral ready <slug> --json`).
   - **Maintenance family**
     - `neutral prs --json` → every in-scope open PR (own `integration/*` and
       `fix/issue-*`) with the **single rung action** `reconcilePR` should take this
       tick (`merge-base | resolve-conflict | fix-ci | review | ready-hold | wait |
       stuck | held`). The CLI decides the rung from observed state — you act, you do
       not re-decide.
     - `neutral issues --json` → every open `neutral:fix` issue with its fix-attempt
       state (`needs-fix | attempt-exists | stuck`).
3. **Fan out** every **branch-disjoint** gap concurrently (LLP 0010) — implement a
   change set, resolve a conflict on PR X, fix CI on PR Y, review PR Z, mint a
   design, write the fix for issue I. Each worker is blind to the others and works in
   its **own** `git worktree` (never the main checkout).
4. **Fan in** — *you*, the orchestrator, perform the serial verified merges and
   **re-derive "done" from git/`gh`** before anything counts. A worker's report is a
   hint; the re-derivation is the conclusion.
5. **Emit one log line per gap acted on:**
   `tick: family=<pipeline|maintenance> target=<slug|pr#N|issue#N> action=<…> detail=<…>`.
6. Return. The loop schedules the next tick.

### Disjointness — the fan-out lock (LLP 0010)

**Disjointness key = the target branch / PR.** At most **one** worker per
`integration/<slug>` (or per PR) per tick — LLP 0003's
one-merge-flow-per-integration-branch lock, generalized. Different branches run in
parallel; same-branch work serializes. This is what stops PR-health's base-merge on
`integration/X` racing the Implementer's task-merge on the same branch. When the
Workflow concurrency cap is hit, **priority is only queue order** (held-PR
dependents → review → implement → issue-fix → design); it no longer selects a single
action.

## Fan-out worker: Designer (pipeline)

Goal: every live request is `@ref`'d by a `design` LLP. Plan the **whole** backlog
up front and mint **all** change sets in one pass (do not dribble one group per tick).

1. `neutral backlog --json` — the full backlog (already excludes code-, in-flight-,
   and baseline-covered requests). Empty → no Designer work.
2. **Plan the partition** (one reasoning pass, whole backlog in view):
   `[{ slug, covers: [<request #s>], dependsOn: [<other slugs in this plan>] }, …]`.
   Each request in exactly one group; group what's implementable together (shared
   `Systems:`, dense `Related:`, a natural feature boundary); order with `dependsOn`
   so B follows A when B builds on A's code; keep groups independent where you can.
   `log` the plan (one line per group).
3. **Mint every change set** in topological order, sequential LLP numbers across the
   batch (start at one past the highest LLP number across `<DEFAULT>` and all
   `integration/*`; `git ls-tree -r --name-only <ref> llp/`). For each, in its **own
   detached worktree** (never the main checkout, LLP 0012):
   - `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/<DEFAULT> && cd "$WT"`
   - mint `llp/NNNN-<slug>.design.md`: `**Type:** design`, `**Status:** Active`,
     `**Systems:**`, `**Generated-by:** neutral`, `**Depends-on:** <predecessors>`
     (omit if none); body = the technical design with one `@ref LLP NNNN — <gloss>`
     per covered request (this satisfies coverage).
   - `git add llp/ && git commit && git push origin HEAD:integration/<slug>` (creates
     the remote branch); then `cd <repo> && git worktree remove --force "$WT"`.
4. **Verify:** `neutral backlog` is now **empty**. Never commit a design to the target branch.

## Fan-out worker: Impl-designer (pipeline)

Goal: every neutral-minted `design` LLP has a `plan` LLP.

1. In its **own detached worktree** (never the main checkout, LLP 0012):
   `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/integration/<slug> && cd "$WT"`.
2. Mint `llp/NNNN-<slug>.plan.md` (`**Type:** plan`, `**Status:** Active`,
   `**Related:** <design #>`, `**Generated-by:** neutral`). Refine into small,
   independently-mergeable tasks; write a `## Tasks` block in the parser's format:
   ```
   ## Tasks
   - id: T1  branch: task/<slug>/T1  deps: []        -- <brief>
   - id: T2  branch: task/<slug>/T2  deps: [T1]      -- <brief>
   ```
   Encode real code dependencies in `deps`.
3. **Commit + push:** `git add llp/ && git commit && git push origin HEAD:integration/<slug>`.
4. **Verify** from the worktree: `neutral ready <slug> --json` parses and lists the
   tasks. Then `cd <repo> && git worktree remove --force "$WT"`.

## Fan-out worker: Implement (pipeline, the wave-loop Workflow)

Goal: every task is a verified-merged commit on `integration/<slug>`.

1. **Prune** stale worktrees: `git worktree prune`.
2. Ensure `integration/<slug>` is **current**: if its `Depends-on:` predecessors are
   now merged to target (`changeSetMergedToTarget`), bring the updated target in
   first — in a **detached worktree**, never the main checkout (LLP 0012):
   `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/integration/<slug> && cd "$WT" && git merge --no-edit origin/<DEFAULT> && git push origin HEAD:integration/<slug>`,
   then `cd <repo> && git worktree remove --force "$WT"`. A change set whose
   predecessors are NOT merged is blocked — skip this tick.
3. **Launch the implement-changeset Workflow** (the wave loop lives in its JS).
   Invoke the **Workflow tool** with `scriptPath` = `<this skill's base
   directory>/implement-changeset.workflow.js` and `args: { repo: <abs path from
   git rev-parse --show-toplevel>, slug: "<slug>", integration: "integration/<slug>" }`.
4. **Re-verify every merge from git** after it returns — the report is a hint.
   `neutral ready <slug> --json`: each claimed-done task must be a real ancestor of
   `integration/<slug>`. Re-dispatch anything claimed-but-not-landed (idempotent).
   After **K=3** failed attempts on a task, stop, label its PR `neutral:stuck`,
   comment why, surface it — do not loop forever.

Then the change set's PR is driven by **reconcilePR** below (the shared spine).

## Fan-out worker: reconcilePR — PR health (shared spine, LLP 0009)

Goal for **every in-scope open PR** (own `integration/*` change sets AND
`fix/issue-*` fixes): **mergeable ∧ green ∧ reviewed**, then **held for a human**.
The rungs are strictly ordered and `reconcilePR` climbs **one rung per PR per tick,
then re-observes** — any push moves the head SHA, so every downstream fact is
recomputed next tick. Distinct PRs advance in **parallel** (branch-disjoint).

Do NOT re-derive the rung in prose. Read it from `neutral prs --json` — the `action`
field per PR is the deterministic decision (`src/prhealth.js`). Act on it:

- **First, ensure the PR exists.** A change set with merged tasks but no PR needs a
  **draft** PR `integration/<slug> → DEFAULT` (`gh pr list --head …` else
  `gh pr create --draft --base DEFAULT --head …`), body ending `Change-Set: <slug>`.
  A `fix/issue-*` PR is created by the issue-fix worker (below) with `Fixes #N`.
- **`merge-base`** (rung 1, `BEHIND` — stale, no conflict): **mechanical, no agent**,
  in a **detached worktree** (never the main checkout, LLP 0012) — `<pr-branch>` is
  `integration/<slug>` or the `fix/issue-*` branch:
  `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/<pr-branch> && cd "$WT" && git merge --no-edit origin/<DEFAULT> && git push origin HEAD:<pr-branch>`,
  then `cd <repo> && git worktree remove --force "$WT"`. Re-observes next tick.
- **`resolve-conflict`** (rung 1, `DIRTY` — the **highest-blast-radius** action):
  dispatch ONE agent in its own worktree. It resolves the conflict and must get a
  **green local test run BEFORE pushing**. The local run is a *precaution only*; CI
  (the green rung) is the authoritative gate after the push (LLP 0002 — the resolving
  agent does not grade its own merge). If it cannot get a clean resolution + green
  local run, it **backs off (no push)** and the PR is labelled `neutral:stuck`.
- **`fix-ci`** (rung 2, `FAILURE`): dispatch ONE agent to fix from the failing logs
  (`gh run view --log-failed`), in its own worktree, push. Re-observes next tick.
- **`review`** (rung 3, head not yet reviewed): dispatch the review in its **own
  worktree** (never the main checkout, LLP 0012) — `dual-review` does a `gh pr
  checkout --detach` *in place* and **refuses on a dirty tree**, so it must run in a
  clean, isolated checkout. Run the review — `dual-review` when `command -v codex`
  succeeds, else `code-review` — on the PR number. **Capture the head SHA you
  reviewed** (the `headSha` from `neutral prs`). For each actionable
  finding, dispatch a fix and **positively verify** it landed (the named file/symbol
  changed in the committed tree vs pre-fix HEAD — a green suite is not proof a fix
  landed; LLP 0002 §Reviewed). Then **record the reviewed head**: append
  `<!-- neutral-review: <the head SHA you reviewed> -->` to the PR body
  (`gh pr edit <N> --body …`). If you fixed findings the head has since moved, so the
  next tick re-reviews the new head (round 2); if the review was clean the marker now
  covers the current head and the PR is terminal. The CLI bounds this to **N=2**
  rounds before it returns `stuck`.
- **`stuck`** (rung 3, unresolved past N rounds): label the PR `neutral:stuck`,
  comment the unresolved findings, surface it — do not churn.
- **`ready-hold`** (terminal — mergeable ∧ green ∧ reviewed, still a draft):
  `gh pr ready <N>` and **HOLD**. Never merge; never `gh pr ready` a PR neutral does
  not own.
- **`wait`** / **`held`**: do nothing this tick.

## Fan-out worker: Issue-fix (maintenance, LLP 0009)

Goal: every open `neutral:fix` issue has a **fix attempt** — a `Fixes #N` PR, or a
documented `neutral:stuck`. The reconciler's whole job is **issue → fix PR**;
`reconcilePR` then carries that PR to held + green + reviewed (the two invariants
compose). The label is the **authorization** — no `neutral:fix`, no action.

For each issue `neutral issues --json` reports as **`needs-fix`** (skip
`attempt-exists` — resume via `reconcilePR`; skip `stuck` — a human must look):

1. **Idempotent intake** (the CLI already checked): `fix/issue-N` branch off the
   default branch (resume `origin/fix/issue-N` if it exists).
2. Dispatch ONE fix agent in its own worktree under the **diagnose/bugfix
   discipline** — *reproduce → root-cause → fix*, where **reproduce = a regression
   test that FAILS on current code and PASSES after the fix**. The agent works out
   how to run the tests in context (no configured command); its local run is advisory.
3. **Ground-truth gate (LLP 0002):** no reproducing failing-then-passing test ⇒ no
   credible fix ⇒ **no PR**. Label the issue `neutral:stuck` and surface it. Never
   open a PR on an unproven fix.
4. With a proven fix: open the PR `fix/issue-N → DEFAULT`, body ending **`Fixes #N`**
   (GitHub closes the issue *on merge*; neutral never closes it). Hand off to
   `reconcilePR`.
5. **Escalate, don't force:** if the "bug" is really a missing feature or an
   architectural change, file a **request LLP** instead — it re-enters the pipeline
   family, not the maintenance family.

## Fan-in: serial verified merges + re-derive

After the parallel workers return, **you** do the non-parallel, verified parts:
the task→integration merges (inside the implement Workflow's serial merger), and
re-deriving every "done" from git/`gh` (`neutral ready`, `git merge-base
--is-ancestor`, `gh pr view --json`). A worker that failed leaves its gap open;
next tick re-observes and re-dispatches (idempotent — partial failure is normal).

## Stage: Handoff (after a human merges)

A predecessor change set is **merged** only when, after `git fetch`, its `design`
LLP is present on `origin/<DEFAULT>` (`changeSetMergedToTarget` — robust to squash
vs merge commit, unlike a body trailer). Corroborate with `gh pr view <N> --json
state` = `MERGED` if known. Only then may a change set whose `Depends-on:` named it
begin. Delete the merged integration branch (local + `git push origin --delete`).

## Invariants

- **One `/loop` session per repo.** Parallelism is *intra-tick* via sub-agents;
  exactly one orchestrator touches the repo (LLP 0010). Two reconcilers racing the
  same repo is unsafe — nothing in git prevents it, so don't.
- **Never merge.** Merging is the one irreversible act, always a human's. Drive to
  held + green + reviewed and stop.
- **Never push to the target branch.** All design/plan/code/fixes land via a held PR.
- **Never `gh pr ready` (or otherwise act on) a PR neutral does not own.** In scope
  today: own `integration/*` and `fix/issue-*` only. **Foreign-PR adoption
  (`neutral:adopt`) is deferred** — if such a PR appears, handle it manually
  (LLP 0008 §Scope, LLP 0009 §Deferred).
- **Branch-disjoint fan-out.** At most one worker per `integration/<slug>` / PR per tick.
- **Head-SHA keying.** "Green" and "reviewed" only count for the *current* head SHA;
  re-read it each tick.
- **PENDING / UNKNOWN = wait, not act.** A running check or computing mergeability is
  not failure.
- **Self-created worktrees; the main checkout is read-only.** The Workflow runtime's
  built-in `isolation:'worktree'` fails in this repo, so every worker runs `git
  worktree add` itself — and so does the orchestrator for its *own* git mutations
  (queue read, serial merger, `merge-base` rung, design/plan minting, review). The
  orchestrator never `git switch`es or writes the main checkout, so a dirty working
  tree or a human editing the repo never blocks a tick (LLP 0012). Orchestrator
  worktrees are **detached** (`git worktree add --detach origin/<branch>`, push via
  `HEAD:<branch>`) so they never collide with a branch checked out elsewhere.
- **Squash only at the final PR.** Task→integration merges are `--no-ff` (so
  `--is-ancestor` holds). The `integration → target` PR is the only squash.
- **Idempotent dispatch.** Before creating any branch, check it exists; if so, resume.

## Quick start (run one tick by hand)

```sh
git fetch --prune
neutral backlog --json     # pipeline: any design work?
neutral prs --json         # maintenance: each in-scope PR's next rung action
neutral issues --json      # maintenance: each neutral:fix issue's state
# then fan out the branch-disjoint workers above and re-derive from git.
```
