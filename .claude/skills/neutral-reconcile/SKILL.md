---
name: neutral-reconcile
description: Run one reconcile tick of the neutral pipeline — observe git/file ground truth, pick the single most out-of-state change set, and advance it exactly one stage (design → plan → implement → PR → review → hold). Idempotent and safe to re-run. Use when running `/loop /neutral-reconcile` to autonomously drive out-of-draft request LLPs to review-ready PRs, or to run one tick by hand.
allowed-tools: Bash, Read, Write, Edit, Agent, Skill
---

# neutral-reconcile

One **tick** of the neutral reconciler. Each tick observes ground truth, picks the
single highest-priority gap, advances it **exactly one stage**, verifies the
result against git, and returns. Re-running is always safe — state is derived, not
stored. Designed to be driven by `/loop /neutral-reconcile`.

## The one rule

**Never trust a claim of "done" — re-derive it from git.** A task is merged only
when `git merge-base --is-ancestor` says so; a change set is merged only when its
PR shows merged and its docs are on the target branch. The Node CLI
(`node bin/neutral.js …`) and git are the authority; agents do work, the tick
verifies it. (See LLP 0001/0002.)

## Each tick

1. **Fetch.** `git fetch --prune`. Without this, a teammate's push and the human's
   merge are invisible and the loop looks wedged.
2. **Observe.**
   - `node bin/neutral.js status --json` → corpus + coverage (working tree / `main`).
   - `git for-each-ref --format='%(refname:short)' refs/heads/integration` → in-flight change sets.
   - For each `integration/<slug>`: read its `design`/`plan` LLPs
     (`git show integration/<slug>:llp/…`) and its task state (`neutral ready <slug> --json`).
   - A request is **covered** if a `design` LLP on `main` OR on any `integration/*`
     branch `@ref`s it, or code does. Do not re-design an already-in-flight request.
3. **Pick one gap** by the priority order below (deterministic; tie-break = lowest
   change-set / request number, so a restarted tick picks the same gap).
4. **Advance it one stage** (the matching section below).
5. **Verify** against git, then **emit one log line**:
   `tick: changeset=<slug> stage=<stage> action=<what> detail=<…>`.
6. Return. The loop schedules the next tick (git-ref watcher + heartbeat).

## Priority order (highest first)

1. **Held PR whose predecessors just merged** → advance dependents (see Handoff).
2. **Change set with an open, reviewed-passing PR not yet held** → flip to ready + HOLD.
3. **Change set with an open PR needing review/fix** → Review stage.
4. **Change set with a `plan` but unmerged tasks** → Implement stage.
5. **`design` LLP without a `plan`** → Impl-designer stage.
6. **Uncovered request(s)** (`neutral coverage` exits 1) → Designer stage.

Advance only the single highest-priority gap per tick. Within a stage, drain
(the Designer may group several requests; the Implementer drains all task waves).

## Stage: Designer

Goal: every live request is `@ref`'d by a `design` LLP.

1. `node bin/neutral.js backlog --json` — the authoritative list of requests that
   need a design (it already excludes requests covered by code or by an in-flight
   `integration/*` design). If empty, there is no Designer work this tick.
2. **Decide grouping + order.** Group requests that are designed/implementable
   together; pick a short kebab `<slug>` for the change set. If this change set must
   follow others, note them for a `Depends-on:` header. You have full authority over
   which requests to group and in what order.
3. **Create the change-set branch:** `git switch -c integration/<slug> origin/<DEFAULT>`
   (DEFAULT = `node bin/neutral.js` target, i.e. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).
4. **Mint the `design` LLP** at `llp/NNNN-<slug>.design.md`. NNNN = one more than the
   highest LLP number across `main` and all `integration/*` branches
   (`git ls-tree -r --name-only <ref> llp/`). Header: `**Type:** design`,
   `**Status:** Active`, `**Systems:**`, `**Generated-by:** neutral`, and
   `**Depends-on:**` if any. Body: the technical design, with one
   `@ref LLP NNNN — <gloss>` line per request it covers (this is what satisfies
   coverage). Use the `llp-create` skill conventions if helpful.
5. **Commit + push:** `git add llp/ && git commit && git push -u origin integration/<slug>`.
6. **Verify:** `git switch -` back; confirm the design's `@ref`s cover the targeted
   requests (re-run the observe step — those requests must now read covered via the
   integration branch). Never commit the design LLP to the target branch.

## Stage: Impl-designer

Goal: every `design` LLP has a `plan` LLP.

1. `git switch integration/<slug>`.
2. For the design LLP, **mint a `plan` LLP** at `llp/NNNN-<slug>.plan.md`
   (`**Type:** plan`, `**Status:** Active`, `**Related:** <design number>`,
   `**Generated-by:** neutral`). Refine the design into concrete tasks and write a
   `## Tasks` block exactly in the parser's format:
   ```
   ## Tasks
   - id: T1  branch: task/<slug>/T1  deps: []        -- <brief>
   - id: T2  branch: task/<slug>/T2  deps: [T1]      -- <brief>
   ```
   Keep tasks small and independently mergeable; encode real code dependencies in `deps`.
3. **Commit + push** the plan to `integration/<slug>`.
4. **Verify:** `node bin/neutral.js ready <slug> --json` parses and lists the tasks
   (all ready/blocked, none done). `git switch -`.

## Stage: Implement

Goal: every task is a verified-merged commit on `integration/<slug>`.

1. **Prune** stale worktrees: `git worktree prune`.
2. Ensure `integration/<slug>` exists and is pushed.
3. **Launch the implement-changeset Workflow** (the wave loop lives in its JS, not
   here). Invoke the **Workflow tool** with
   `scriptPath: .claude/skills/neutral-reconcile/implement-changeset.workflow.js`
   and `args: { repo: <abs repo path>, slug: "<slug>", integration: "integration/<slug>" }`.
4. **Re-verify every merge from git** after it returns — the Workflow's report is a
   hint, not a conclusion. `node bin/neutral.js ready <slug> --json`: each task it
   claims done must be a real ancestor of `integration/<slug>`. Re-dispatch anything
   claimed-but-not-landed (the Workflow is idempotent). After **K=3** failed
   attempts on a task, stop, label its PR `neutral:stuck`, comment why, and surface
   it — do not loop forever.

## Stage: PR + Review + fix

Goal: the change-set PR passes review, then holds for a human.

1. **Ensure a draft PR** `integration/<slug> → DEFAULT` exists
   (`gh pr list --head integration/<slug>`; else `gh pr create --draft --base DEFAULT
   --head integration/<slug>`). The PR body must end with a `Change-Set: <slug>`
   trailer (so the squash commit on target carries it).
2. **Review.** Detect Codex: if `command -v codex` succeeds, run the `dual-review`
   skill on the PR number; else run `code-review`. Read the structured verdict
   (`.git/dual-review/pr-<N>/dual-review.md` / `state.env`) or the posted comment.
3. **Fix loop (≤ N=2 rounds).** For each actionable finding, dispatch a fix (a
   worktree agent on `integration/<slug>` or the relevant `task/<slug>/<id>`).
   **Positive verification:** the finding names a file/symbol — confirm that path's
   content changed in the committed tree vs the pre-fix HEAD (a green suite is not
   proof a fix landed). Re-merge with `--no-ff`, re-verify.
4. When the verdict is `approve` (or no actionable findings remain after N rounds):
   `gh pr ready <N>` and **HOLD** — never merge to the target yourself.

## Stage: Handoff (after a human merges)

A predecessor change set is **merged** only when, after `git fetch`, its `design`
LLP is present on `origin/<DEFAULT>` (`changeSetMergedToTarget` in `src/git.js` —
robust to squash vs merge commit, unlike a body trailer). Corroborate with
`gh pr view <N> --json state` = `MERGED` if the PR is known. Only then may a change
set whose `Depends-on:` named it begin (its stages run off the now-updated target).
Delete the merged integration branch (local + `git push origin --delete`).

## Invariants

- **One `/loop` session per repo.** Two reconcilers racing the same repo is unsafe;
  nothing in git prevents it, so don't.
- **Never push to the target branch.** All design/plan/code land via the held
  change-set PR; only a human merges it.
- **Squash only at the final PR.** Task→integration merges are `--no-ff` (so
  `--is-ancestor` holds). The `integration → target` PR is the only squash.
- **Idempotent dispatch.** Before creating any branch, check it exists
  (`git rev-parse --verify`); if so, resume from it — never force-recreate.

## Quick start (run one tick by hand)

```sh
node bin/neutral.js coverage        # is there a backlog?
node bin/neutral.js status --json   # observe
# then follow the highest-priority stage above for one change set.
```
