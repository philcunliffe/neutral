# LLP 0033: Done requires work parentage, not bare ancestry

**Type:** Decision
**Status:** Active
**Systems:** Engineer
**Author:** Phil / Claude
**Date:** 2026-07-23
**Related:** 0002, 0003, 0010

## Context

The done-set is derived from git: a task is done iff its branch is a verified
ancestor of the integration branch (LLP 0002). That predicate has a hole a
production run fell through (hypaware install-experience-overhaul, 2026-07-22):
an implementer's first git act was `git worktree add -b task/<slug>/T11
origin/integration/<slug>` — a branch born AT the integration head with zero
work commits. A branch pointing at the integration head is trivially an
ancestor of it, so the next derive-ready wave read the task as done, the wave
loop declared the change set complete, fan-in opened and merged the change-set
PR without the task's deliverable, and every later derivation kept agreeing
(ancestry, once true, stays true). The task was silently never built.

Bare ancestry cannot distinguish "my commits were merged" from "I have no
commits". The fix needs a second, equally git-native discriminator.

## Decision

<a id="off-first-parent"></a>**A task is done iff its branch tip is an ancestor
of the integration branch AND that tip is NOT on the integration branch's
first-parent chain.** The serial merger integrates every task with
`git merge --no-ff` precisely so parentage survives (LLP 0010); under that
contract a genuinely merged task tip is only ever reachable as a merge
commit's second parent, strictly off the first-parent chain. An empty branch —
created at the integration head, or parked at any older integration commit —
sits ON the chain and now reads not-done. `doneSetFromGit` (src/git.js)
computes the chain once per change set (`git rev-list --first-parent`) and
applies both checks.

<a id="branch-birth"></a>**An implementer never creates the task branch before
its first work commit.** The implement-changeset workflow's worker protocol
works on a detached worktree (fresh: detached at `origin/integration/<slug>`;
resume: detached at `origin/task/<slug>/<id>`) and publishes with
`git push origin HEAD:refs/heads/task/<slug>/<id>` only after committing. The
branch's existence now itself implies work, killing the race at the source
(defense in depth with the parentage check) and, as a side effect, ending the
stale-local-branch collisions (`fatal: a branch named ... already exists`)
that dogged re-dispatched workers.

## Rejected

<a id="trailer-rejected"></a>**Requiring a `Task-Id: <id>` commit trailer on
the branch, rejected.** The trailer is a worker convention inside one prompt,
not ground truth; a worker that phrases it differently would strand a genuinely
merged task in not-done forever. Parentage is structural — the commit graph
cannot fake it and no agent has to remember to write it.

<a id="nonempty-diff-rejected"></a>**Requiring a non-empty diff against the
merge base, rejected.** After a fast-forward there is no base to diff against,
and after the --no-ff merge the diff is empty by construction (the work is in
integration). Every content-shaped predicate degenerates; only parentage
survives the merge.

## Consequences

- False-positive direction is closed; the residual false-negative direction
  (a task branch someone hand-fast-forwarded integration onto would read
  not-done) fails toward re-dispatching work, never toward skipping it —
  the failure polarity LLP 0002 already prefers.
- The wave loop's re-verify step and `neutral ready` inherit the fix for free
  (both call `doneSetFromGit`).
- The reconcile skill's "Merged?" definition gains the off-first-parent
  clause; the merger prompt's `--no-ff` requirement is now load-bearing for
  correctness, not just for `--is-ancestor` stability.
