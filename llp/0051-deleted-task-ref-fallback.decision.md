# LLP 0051: A deleted task ref falls back to the merge commit, not to "not done"

**Type:** Decision
**Status:** Active
**Systems:** Engine, Engineer
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0002, 0003, 0010, 0033

## Context

`doneSetFromGit` resolves a task's branch first and treats an unresolvable ref
as "that task is not done" (LLP 0033). That reading assumes the ref outlives the
merge. It does not: GitHub's per-repo **"Automatically delete head branches"**
(`delete_branch_on_merge`) erases the head ref the instant a PR merges, and
nothing in neutral owns that setting.

A production run hit it (hyparam/hypaware, change set `openclaw-full-capture`,
2026-07-30/31). All ten task PRs were merged through GitHub's UI; every
`task/openclaw-full-capture/T<n>` ref vanished on merge. The next derivation
read ten landed tasks as **ready/unstarted** and left the dependent T11
**blocked**. The loop re-dispatched nothing (the mayor caught it), but the queue
lied twice and a human hand-restored the refs twice
(`git push origin <sha>:refs/heads/task/<slug>/T<n>`).

The deleted ref is not the missing fact. The merge is still in the commit graph
in full: a merge commit on the integration branch's first-parent chain, whose
second parent is the task tip. Only the *name* that pointed at the tip is gone —
and the merge commit's own subject preserves it. Deriving from an erased pointer
when the evidence is still there is a gap in the derivation, not a missing fact.

## Decision

<a id="merge-evidence"></a>**When — and only when — a task's branch ref does not
resolve, `done` is derived from the integration branch's merge commits instead:
a task is done iff a merge commit on integration's first-parent chain names the
task branch in its subject AND that merge's second parent is off the
first-parent chain.** The ref-present path is unchanged; the fallback fires
purely on a missing ref, so a repo that keeps its refs never reaches it.

The second-parent-off-the-chain check is the same discriminator LLP 0033
introduced, read from the other end. Every property 0033 bought survives: a
branch created at the integration head with no work commits merges with its
second parent *on* the chain, so the empty-branch hole stays closed even when
that branch's ref is later deleted.

Both merge shapes neutral actually sees carry the branch name: the serial
merger's `git merge --no-ff origin/task/<slug>/<id>` ("Merge remote-tracking
branch 'origin/task/…'") and GitHub's merge-commit PR merge ("Merge pull request
#N from <owner>/task/…"). The name is matched at path boundaries, so
`…/T1` never matches inside `…/T10`.

<a id="derivation-stays-read-only"></a>**The derivation never repairs the ref.**
Re-pushing the tip from the merge's second parent would answer a read-only
question with a write to the repo. Restoring an erased ref by hand stays a human
operational act; the reconciler only reads.

## Rejected

<a id="trailer-still-rejected"></a>**Falling back to the `Task-Id: <id>` commit
trailer, rejected — again.** LLP 0033#trailer-rejected ruled it out as ground
truth because it is a worker convention inside one prompt, and being a fallback
does not upgrade it. A merge subject is written by `git merge`/GitHub, not by
the agent whose work is being graded (LLP 0002).

<a id="gh-api-rejected"></a>**Asking the GitHub API whether the task PR merged,
rejected.** The done-set is derived from the commit graph alone and must stay
testable offline against a bare repo. A PR's merged flag also reports the PR,
not the commit that reached *this* integration branch.

<a id="require-setting-rejected"></a>**Requiring `delete_branch_on_merge=false`
on every neutral-driven repo, rejected — and auto-delete is left ON.** A
reconciler whose correctness depends on a repo setting it does not own is one
settings change away from lying again. Beyond that, deleting the merged head ref
is what every other tool on GitHub already expects, and neutral has no branch
reaper of its own: with auto-delete off, one dead `task/<slug>/<id>` ref
accumulates per task, forever (`philcunliffe/neutral` still carries
`task/llp-show-command/T1` from an old change set). Leaving the setting on makes
GitHub the reaper. The derivation is fixed; the repo settings are not neutral's
to constrain.

## Consequences

- Attribution in the fallback path is by name, not by structure — the one place
  the derivation reads text. It is bounded: it fires only when the ref is gone,
  and the second-parent check still gates the answer.
- Failure polarity is preserved. A squash- or rebase-merged task PR leaves no
  merge commit and still reads not-done — the merger's `--no-ff` contract
  (LLP 0010/0033) remains load-bearing, and the residual error direction is
  re-dispatch, never skip.
- `neutral ready`, the wave loop's re-verify, and the reconcile skill's
  "Merged?" test inherit the fallback for free (all call `doneSetFromGit`).
- On a repo with auto-delete on, this path is the **normal** one for every
  merged task, not an exception — the merge subject's branch name is a contract,
  not a nicety. `doneSetFromGit` is the only place in `src/` that resolves a task
  branch at all; the implementer's resume path and the merger's verification
  steps touch it strictly before the merge, while it still exists.
- Nothing else has to change to keep working under auto-delete, and neutral
  gains no branch reaper it would otherwise have had to grow.
