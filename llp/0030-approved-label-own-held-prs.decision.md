# LLP 0030: `neutral:approved` covers own held PRs, not just adopted ones

**Type:** Decision
**Status:** Accepted
**Systems:** Reviewer, Engineer
**Author:** Phil / Claude
**Date:** 2026-07-14
**Related:** 0000, 0002, 0009, 0025

## Decision

An own PR (`integration/*`, `fix/issue-*`) at its terminal rung — mergeable ∧ green ∧
reviewed, held for a human merge — **also carries `neutral:approved`**, set idempotently
(`--add-label`, set-if-absent) as part of the `ready-hold` action, alongside the
`gh pr ready` flip. The label's meaning generalizes to a single sentence that holds for
**both** own and adopted PRs: *neutral reviewed this at the current head and holds it for a
human to merge*.

## Why

LLP 0025 minted `neutral:approved` as the terminal verdict for **adopted** foreign PRs and
kept it adopt-only: own PRs terminated at `ready-hold` (flip ready + HOLD) with **no**
terminal label, their reviewed state carried only by the head-SHA review-record comments
(LLP 0028/0029). That leaves a maintainer scanning the PR list unable to tell, at a glance
or with a `label:` filter, which own PRs neutral has actually driven to *ready-to-merge*
from those still climbing the ladder — the draft/ready flag alone is ambiguous (a human can
ready a draft, and a readied PR can still be mid-review after a new push). One label that
already means exactly "reviewed and held for merge" should say so for every PR neutral
holds, not only the foreign ones.

## Chosen over

- **A separate `neutral:held` label for own PRs.** Rejected as redundant: `neutral:approved`
  already denotes precisely this state. Two labels for one meaning splits the maintainer's
  filter and invites drift between them.
- **Leaving own PRs label-less (status quo).** Rejected: the whole ask is a single,
  filterable, at-a-glance approval signal across the PR list.

## Scope and invariants (unchanged)

This adds a label at an **existing** own-PR terminal; it moves no autonomy boundary.

- The terminal *action* still differs by ownership: own PRs also `gh pr ready` (they are
  neutral's to ready); an adopted PR is **never** readied or merged by neutral — its
  terminal stays a verdict label only (LLP 0000 §Autonomy, LLP 0025).
- Never-merge, never-push-to-target, and never-`gh pr ready`-a-foreign-PR are untouched.
- `selectRung` stays a pure classifier — it still returns `ready-hold` / `held`. The label
  is applied by the orchestrator when it *executes* `ready-hold`, not encoded in the rung.

## Ground truth

The label is a **cache** of the terminal derivation (mergeable ∧ green ∧ reviewed-at-head),
set-if-absent at the ready-flip and re-derived every tick — the same model LLP 0025 §Ground
truth already specifies for the adopted path. A new head that drops the PR below terminal is
handled by the identical head-SHA review re-derivation: the review record no longer covers
head, so the reviewed rung re-opens and the maintainer sees the recomputed rung. Neutral
does not actively strip the label on drop today (nor does the adopted path); the per-tick
rung, not the label, is the authority.

## Constraints

- `@ref LLP 0025 [constrained-by]` — extends the `neutral:approved` semantics minted there
  from adopt-only to own held PRs; the foreign terminal (label-only, never readied) is
  unchanged.
- `@ref LLP 0000 [constrained-by]` — the autonomy boundary is unmoved: neutral still holds,
  never merges; a foreign PR is still never readied.
- `@ref LLP 0002 [constrained-by]` — the label is a re-derived cache of a per-tick
  derivation, set idempotently, never a stored fact.
- `@ref LLP 0009 [constrained-by]` — the rung ladder and one-rung-per-tick are unchanged;
  only the `ready-hold` action gains an idempotent label set.
