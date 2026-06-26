# LLP 0009: Maintenance reconcilers — PR health and issue-fix

**Type:** Spec
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil
**Date:** 2026-06-25
**Related:** 0000, 0002, 0003, 0007, 0008, 0010

## Summary

The **maintenance family** (LLP 0008) reconciles existing GitHub artifacts a human
delegated by label, not request LLPs. Two reconcilers — **issue-fix** and **PR
health** — converge on one shared unit, `reconcilePR`, and hold every result for a
human (never merge). This spec defines their triggers, base states, the
ground-truth predicates that decide "done", and the `reconcilePR` rungs.

## The authorization gate

Neutral acts on an artifact it did not mint only when a human has explicitly
delegated it with a label — the maintenance counterpart to `Generated-by: neutral`
for minted designs (LLP 0007):

- `neutral:fix` on an issue → neutral may attempt a fix.

No label, no action. The label is the authorization; this is what keeps neutral
from acting on every bug on a public repo. Neutral's **own** pull requests
(change-set and fix PRs) are in scope by ownership and need no label.

State label neutral *sets*: `neutral:stuck` (an attempt neutral cannot complete —
surfaced for a human, never retried blindly). The `neutral:approved` /
`neutral:changes-requested` terminal labels arrive with foreign-PR adoption
(deferred — see below).

## Issue-fix reconciler

**Trigger:** an open issue labelled `neutral:fix`.
**Base state (thin):** every such issue has a *fix attempt* — a pull request linked
by `Fixes #N`, or a documented `neutral:stuck`.

The reconciler's whole job is **issue → fix PR**; the resulting PR then enters the
PR-health reconciler, which carries it to held + green + reviewed. The two
invariants **compose** — the issue is satisfied at "attempt exists", the PR
invariant finishes the work — so a bug reaches neutral state only when a held,
green, reviewed fix PR exists (or the issue is `neutral:stuck`).

Steps (idempotent):

1. Skip if a `fix/issue-N` branch or a `Fixes #N` PR already exists — resume it,
   never duplicate (re-derived from git/`gh`, not a stored flag; LLP 0002).
2. Branch `fix/issue-N` off the default branch.
3. Dispatch a fix agent under the diagnose/bugfix discipline: **reproduce → root
   cause → fix**, where *reproduce* means a regression test that **fails** on the
   current code and **passes** after the fix.
4. **Ground-truth proof of a fix** (LLP 0002): a previously-failing test now passes
   in the committed tree — the issue-equivalent of "merged = verified ancestor". The
   agent works out how to run the tests in context; its own run is advisory, and CI
   green on the fix PR plus the review rung (which scrutinises the test for
   non-vacuousness) are the authoritative confirmation. No reproducing test ⇒ no
   credible fix ⇒ no PR; label the issue `neutral:stuck` and surface it. Never open
   a PR on an unproven fix.
5. Open the PR `fix/issue-N → default`, body ending `Fixes #N` (GitHub closes the
   issue *on merge*; neutral never closes it). Hand off to the PR-health
   reconciler.

A "bug" that is really a missing feature or an architectural change is
**escalated** — the agent files a request LLP instead of forcing a fix —
re-entering the pipeline family (LLP 0003), not the maintenance family.

## PR-health reconciler

**Trigger:** an open pull request that is neutral's own — an `integration/*` change
set or a `fix/issue-*` fix. (Foreign `neutral:adopt` PRs are deferred — see below.)
**Base state:** **mergeable ∧ green ∧ reviewed**, held for a human.

### reconcilePR — the rungs

`reconcilePR` drives a PR toward **mergeable ∧ green ∧ reviewed**, then holds it.
The rungs are strictly ordered — there is no point reviewing or trusting checks on
a branch that cannot merge — and the reconciler climbs **one rung per PR per tick,
then re-observes**: any push moves the head SHA, so every downstream fact is
recomputed next tick (LLP 0002). One rung per PR per tick also stops it stacking a
fix onto a build that was about to pass. (Distinct PRs advance in parallel — the
per-tick fan-out of LLP 0010.)

1. **Mergeable** — `gh pr view --json mergeable,mergeStateStatus`:
   - `BEHIND` (stale, no conflict) → merge the target in mechanically
     (`git merge origin/<base>`) and push. No agent.
   - `DIRTY` (real conflict) → an agent resolves it. The agent works out how to run
     the project's tests *in context* (no configured command) and must see them
     pass locally before pushing; failing a clean resolution + green run it **backs
     off** (no push) and the PR is labelled `neutral:stuck`. The local run is a
     *precaution* only — CI (the green rung) is the authoritative gate after the
     push (LLP 0002: the resolving agent does not grade its own merge).
   - `UNKNOWN` → wait (GitHub still computing).
2. **Green** — `gh pr view --json statusCheckRollup`, read against the current head
   SHA:
   - `FAILURE`/`ERROR` → an agent fixes from the failing logs
     (`gh run view --log-failed`).
   - `PENDING` → wait (no fix-storm mid-run).
   - `SUCCESS` → rung satisfied.
3. **Reviewed** — run the review (`dual-review` when Codex is present, else
   `code-review`); each actionable finding is fixed and verified resolved in the
   committed tree (LLP 0002 §Reviewed), bounded to **N fix rounds** (the
   `maxReviewRounds` config knob, default 2 — see [LLP 0007](0007-config-and-onboarding.spec.md))
   before `neutral:stuck`. A `<!-- neutral-review: <headSHA> -->` marker records the head a
   review covered, so an unchanged head is not re-reviewed every tick; a new head
   SHA (from rungs 1–2, or a human's push) re-opens review.

**Terminal.** When all three rungs hold, the PR is **held for a human**: a draft is
flipped `gh pr ready` and left for a human to merge — never auto-merged
(LLP 0000 §Autonomy). Merging is the one act neutral never performs; it is also
what, via the change-set DAG, unblocks dependents (LLP 0003).

**Reuse.** `reconcilePR` is shared with the pipeline family — the Reviewer
reconciler (LLP 0000) becomes rung 3 plus the new mergeable/green rungs — so
neutral's own change-set PRs gain the CI and mergeability self-healing the pipeline
previously lacked.

## Deferred: foreign PR adoption

Reviewing and healing pull requests neutral did **not** author (gated by a
`neutral:adopt` label) is out of scope until the repo has external contributors.
It is parked, not forgotten — handle such PRs manually until then. When built it
adds: `canPush` detection (`gh pr view --json isCrossRepository,maintainerCanModify`),
a review-only degradation when neutral cannot push to the head branch, and the
`neutral:approved` / `neutral:changes-requested` terminal labels. The charter
(LLP 0008) already admits it; only the build is deferred. (The head-SHA review
marker is *not* deferred — it is used for neutral's own PRs too; see rung 3.)
