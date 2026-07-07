# LLP 0025: Foreign PR adoption — the `neutral:adopt` reconciler

**Type:** Spec
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-07
**Related:** 0000, 0002, 0007, 0008, 0009, 0024

## Summary

Un-defers the foreign-PR adoption parked in
[LLP 0009 §Deferred](0009-maintenance-reconcilers.spec.md#deferred-foreign-pr-adoption).
A third maintenance trigger — an open PR labelled `neutral:adopt` that neutral did not
author — joins the PR-health reconciler. It is driven by the **same** `reconcilePR` rung
ladder (LLP 0009), gated by push access, and terminates in a **verdict label** rather
than a held-ready flip. This spec supersedes only the *deferral*; the ladder, the
ground-truth predicates, and never-merge are unchanged.

## Trigger and authorization

**Trigger:** an open pull request that is **not** neutral's own (fails the `OWN_HEAD_RE`
ownership test — not `integration/*` or `fix/issue-*`) and carries the `neutral:adopt`
label. The maintainer's label is the authorization (LLP 0024): no label, no action,
exactly as for `neutral:fix` issues.

The PR-health trigger set becomes: neutral's **own** PRs (in scope by ownership, no
label) **∪** foreign PRs labelled `neutral:adopt`.

## Push access: canPush

Whether neutral can push a heal to the PR's head branch — re-derived every tick from
`gh` (LLP 0002: a contributor can toggle it), never stored:

```
gh pr view --json isCrossRepository,maintainerCanModify,headRefName,headRepositoryOwner
canPush = !isCrossRepository || maintainerCanModify
```

A same-repo branch is always pushable. A cross-repo fork is pushable only while the
contributor leaves "allow edits from maintainers" on. `canPush` selects the *mode*; it is
never an authorization question — the label already answered that (LLP 0024).

## The degraded rung ladder

The rungs and their strict order are unchanged (mergeable → green → reviewed → terminal,
one rung per PR per tick — LLP 0009). Two things change for a foreign PR: heal actions are
gated on `canPush`, and the terminal rung emits a verdict label.

**Full-heal mode (`canPush = true`).** Byte-for-byte the own-PR ladder — merge-base a
`BEHIND` branch, resolve a `DIRTY` conflict, fix CI from failing logs, run the review and
fix findings, pushing each heal to the fork's head branch. The *only* divergence from an
own PR is the terminal rung (below).

**Review-only mode (`canPush = false`).** Neutral cannot push, so it cannot heal. Rungs 1–2
degrade from *heal* to *observe-and-report*: a `BEHIND`/`DIRTY`/red PR cannot be advanced by
neutral, so the blocker is surfaced to the contributor via the verdict, not fixed. Rung 3
(review) still runs in full — reviewing costs no push, and a review is the most useful thing
neutral can give a fork it cannot touch.

### Terminal: a verdict label, not a merge

Readying or merging a contributor's PR is the maintainer's call (LLP 0000 §Autonomy), so
the terminal rung sets a label instead of flipping ready:

- **`neutral:approved`** — mergeable ∧ green ∧ reviewed-clean at the current head. Held for
  the maintainer to merge. Re-derived each tick (LLP 0002); a contributor push moves the
  head, the review marker no longer covers it, and the verdict re-opens automatically.
- **`neutral:changes-requested`** — the ball is in the **contributor's** court: review
  findings still unresolved past `maxReviewRounds`, or — in review-only mode — a branch that
  is `BEHIND`/`DIRTY`/red that only the contributor can rebase or fix. The label's comment
  carries what must change.

`neutral:stuck` stays reserved for the case where **neutral itself** cannot proceed and a
*maintainer* is needed — e.g. `canPush` but the conflict-resolution agent backed off
(LLP 0009 rung 1), or an internal failure. The distinction: `changes-requested` = the
contributor acts; `stuck` = a maintainer acts.

The head-SHA review marker (`<!-- neutral-review: <sha> -->`) is reused unchanged — this is
why LLP 0009 kept it out of the deferral.
> **Extended-by [LLP 0028](0028-review-record-comment.decision.md) /
> [LLP 0029](0029-verdict-carrying-review-rounds.decision.md):** the review record is now a
> marker-signed *comment* carrying a `clean|findings` verdict; body markers read as legacy.
> Adopted PRs use the same record — the reuse-unchanged property is preserved. Triage-at-cap (LLP 0017) is an **own-PR**
mechanism: it defers residual non-blockers to a `neutral:fix` follow-up issue against merged
code. A foreign PR is unmerged and its code is the contributor's, so residual non-blockers
ride in the `changes-requested` comment as optional, not a follow-up issue.

## Ground truth

Every terminal label is a **cache** of a per-tick derivation, not a stored fact (LLP 0002):
`approved` ≡ mergeable ∧ green ∧ reviewed-at-head, recomputed each tick and set idempotently
(set-if-absent, exactly as `neutral:stuck` is handled in `selectRung`). A new head
invalidates it for free — the review marker no longer covers head, dropping the PR back down
the ladder.

Adopted PRs are **not** in the change-set DAG (LLP 0008 §Consequences) — a separate axis. A
merged adoption contributes coverage only through the ordinary code-`@ref` path, and needs
no request LLP.

## Implementation surface

Names the constructs this touches; the plan owns the detail.

- **`src/commands/prs.js`** — the scope filter widens from `own` to `own ∪ adopt`:
  `own = OWN_HEAD_RE.test(headRefName)`, `adopt = labels.includes('neutral:adopt')`. Each
  in-scope PR carries `foreign` and `canPush`, from an extended `viewPR` query.
- **`src/prhealth.js` `selectRung`** — gains `foreign` / `canPush`. When `foreign`: heal
  actions are gated on `canPush` (else the action is `request-changes`, a *surface*, not
  `resolve-conflict` / `fix-ci`, a *heal*); the terminal emits `approve` / `request-changes`
  instead of `ready-hold` / `held` / `merge`. Own-PR behaviour is untouched — the new
  parameters default off. It stays a pure classifier, unit-tested offline (CLAUDE.md §Checks).
- **Labels** — `neutral:approved` and `neutral:changes-requested` join `neutral:fix` /
  `neutral:stuck` in the set the `/neutral-init` skill creates (LLP 0009 already reserved the
  two names).
- **Config** — none required; the label is the gate, so a repo with no external contributors
  simply never triggers adoption. A future `adopt: false` / `adoptReviewOnly` opt-out mirrors
  `automerge`'s shape (LLP 0019) — noted, not built.

## Constraints

- `@ref LLP 0024 [constrained-by]` — single-key full-heal authorization; `canPush` selects a
  *mode*, never a gate.
- `@ref LLP 0009 [constrained-by]` — reuses the rung ladder, one-rung-per-tick, and the
  head-SHA review marker verbatim; supersedes only §"Deferred: foreign PR adoption".
- `@ref LLP 0008 [constrained-by]` — adopted PRs are a separate axis from the change-set DAG
  and need no request LLP; the label is the authorization.
- `@ref LLP 0000 [constrained-by]` — terminal is a verdict label, never a merge or a
  ready-flip: neutral holds at the autonomy boundary.
- `@ref LLP 0002 [constrained-by]` — `canPush` and every verdict are re-derived from git/`gh`
  each tick, never stored; a heal is a real pushed commit, a verdict a real review.
- `@ref LLP 0007 [constrained-by]` — no new required config; adoption is label-gated, not
  flag-gated.
