# LLP 0031: `neutral:adopted` — the adoption completion record

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-16
**Related:** 0002, 0009, 0024, 0025, 0030

## Context

An adopted PR's ladder terminates in a verdict label
([LLP 0025](0025-adopt-foreign-prs.spec.md)): `neutral:approved` says *this head is
mergeable ∧ green ∧ reviewed-clean — held for the maintainer*. The merge itself is the
maintainer's act, and it ends the story silently: the PR closes, drops out of
`gh pr list --state open`, and out of every neutral surface. Nothing marks that the
adoption **completed**. A maintainer filtering by `neutral:adopt` sees landed adoptions,
abandoned ones, and in-flight ones as one undifferentiated list, and `neutral:approved`
cannot serve as the completion signal — it is pre-merge and revocable (stripped whenever
the head moves).

## Decision

<a id="completion-record"></a>**A merged PR that carried `neutral:adopt` gains
`neutral:adopted` — the adoption completion record.** Ground truth (LLP 0002): the label
is a cache of `merged ∧ adopt-labelled`, re-derived every tick from
`gh pr list --state merged --label neutral:adopt` and set **set-if-absent** — once
present, the PR never re-enters the work-list, so the query self-terminates. Own-head
PRs (`integration/*`, `fix/issue-*`) are skipped for the same reason they are at
enumeration (LLP 0025): an adopt label on an own PR is redundant — ownership wins, and
an own PR is not an adoption.

<a id="add-only-correct"></a>**Add-only is correct here.** LLP 0030
[rejected add-only](0030-own-pr-approved-label.decision.md#add-only-rejected) for
`neutral:approved` because an open PR's head can move and strand the label over an
unreviewed commit. A merged PR is frozen: the fact the label caches (merged) is
immutable, so the record can never go stale and is never removed.

<a id="cli-decides"></a>**The CLI decides, the skill applies**
([LLP 0030 §cli-decides](0030-own-pr-approved-label.decision.md#cli-decides) pattern).
`neutral prs` enumerates merged adoptions (`src/github.js listMergedAdoptPRs`), the pure
classifier (`src/prhealth.js needsAdoptedLabel`) spots the missing record, and the entry
surfaces as a terminal **`mark-adopted`** action. The skill's act is mechanical — one
`gh pr edit --add-label`, no agent.

## Rejected

<a id="verdict-time-rejected"></a>**Labelling at the `approve` verdict, rejected.** The
verdict is pre-merge and revocable — a contributor push re-opens it. "Adopted" must mean
*landed*, or it duplicates `neutral:approved` and means nothing.

<a id="closed-unmerged-rejected"></a>**Marking closed-but-unmerged adoptions, rejected.**
A maintainer closing an adopted PR without merging is a *rejected* adoption; the
completion record keys on `merged`, GitHub's own fact, not on "the story ended".

<a id="label-swap-rejected"></a>**Swapping `neutral:adopt` → `neutral:adopted`,
rejected.** Removing `neutral:adopt` would rewrite the *maintainer's* authorization act
(LLP 0024 — the label is theirs, not neutral's) and leave the derivation resting solely
on neutral's own artifact. Both labels stay: `adopt` records the delegation, `adopted`
records the completion, and the work-list query keys on their difference.

## Consequences

- `ADOPTED_LABEL` joins the label constants in `src/config.js`.
- `src/github.js` gains the `listMergedAdoptPRs` observer; `src/prhealth.js` the pure
  `needsAdoptedLabel` predicate; `src/commands/prs.js` emits the `mark-adopted` entries
  (so `RungDecision`'s action union in `src/types.d.ts` widens by one).
- The `/neutral-init` skill creates the `neutral:adopted` label alongside the other
  adoption labels; the reconcile skill's adopted-PR section gains the mechanical
  `mark-adopted` act.
- [LLP 0025](0025-adopt-foreign-prs.spec.md)'s terminal section gains an
  `Extended-by: LLP 0031` note: the verdict is no longer the last signal an adoption
  emits.
