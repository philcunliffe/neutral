# LLP 0015: Immutable LLPs — change is a new request

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-06-26
**Related:** 0001, 0002, 0003

> Neutral fires the Designer on **uncovered requests** (`neutral backlog`).
> Expressing new intent by *editing* an already-covered LLP moves no trigger — the
> doc is covered at the number level, and a `decision` is background — so the work
> is invisible. This decision removes the temptation: an Accepted/Active LLP is a
> **record, not a worksheet**. Change is expressed by **minting a new request**
> (`rfc`/`spec`/`issue`) that `@ref`s what it builds on; existing docs gain only a
> **forward-ref**. Because the new request is uncovered, it rides the *existing*
> trigger — **no engine change** — and the corpus becomes an append log with clean
> provenance.

## Context

The pipeline's three observe surfaces fire on *structural* facts:

- **Designer** — `neutral backlog`: live **requests** (`spec`/`rfc`/`issue`) not
  yet `@ref`'d by a design or code ([LLP 0003 §Coverage invariant](0003-coverage-and-change-sets.spec.md#coverage-invariant)).
- **Impl-designer** — a minted `design` without a `plan`.
- **Implementer** — a `plan` with unmerged tasks (`neutral ready`).

Editing an existing, already-covered doc to add a requirement moves **none** of
these: coverage is number-level, so the doc stays "covered"; and if the new
intent lands as a `decision`, decisions are a background role that never triggers
([LLP 0003 §Types and roles](0003-coverage-and-change-sets.spec.md#types-and-roles)).
A downstream repo hit exactly this — a feature expressed by editing existing LLPs
plus a sibling `decision`, and nothing reconciled.

This cuts with the grain the LLP framework already has: an Accepted doc is a
deliberation/decision **record** — "an RFC stays an RFC… it never converts; the
RFC remains the deliberation record" (the global LLP house rules), with a
`Superseded`/`Tombstoned` lifecycle for retirement. Neutral's own former "living
docs" rule was the outlier.

## Options considered

1. **Anchor-granular coverage (rejected).** Keep living docs; track sub-document
   coverage by marking requirement headings (`<!-- @req -->`) and matching them
   against `@ref LLP NNNN#anchor` from designs/code, at two seams
   (request→design/code and design→code). Granularity lives in *anchors within a
   doc*. It works, but it is a real engine change (anchored refs, per-anchor
   two-seam coverage, a slug normalizer, an impl-design trigger rewire), and it
   carries a **semantic-drift hole** — rewording an already-discharged section
   silently re-triggers nothing, because the anchor and its incoming `@ref` are
   unchanged. Catching that would need content-hashing. More mechanism, more
   surface to drift — against [LLP 0001](0001-reconciler-architecture.decision.md).
2. **Immutable docs; change is a new request (chosen).** Move granularity to the
   *document boundary*: make docs small and append new ones. A new request rides
   the existing number-level trigger with **zero** engine change, aligns with the
   LLP framework's record/supersession grain, and has no drift hole — a changed
   decision is a *new* doc that gets built, never a silent in-place edit.

The two are **substitutes**, not complements — both chase fine-grained "what is
unbuilt." Immutable gets it for free; build one, not both.

## Decision

### Change is a new request, not an edit

To add or alter intent, **mint a new request LLP** — an `rfc` when it needs
deliberation, a `spec`/`issue` when it is already crisp. It `@ref`s the LLPs it
builds on or supersedes (upstream provenance + constraint). Being a live request
covered by nothing yet, it appears in `neutral backlog` and the Designer plans it
through the normal pipeline. Nothing in the engine changes.

### Accepted/Active LLPs are semantically immutable

What is frozen is the doc's **decided content** — what it decided or required.
Permitted edits to an Accepted/Active LLP:

- **Trivial editorial** — typos, formatting, broken links, glossing.
- **Appending a forward-ref** — the one structural mutation (below).

Anything that changes *what the doc decided or required* must instead be a new
request. **Drafts are exempt** — a Draft is still being authored, not yet a
record (which is also why rewriting this still-Draft doc from its anchor-coverage
prior form is itself consistent with the rule).

### The forward-ref is the one structural mutation

An existing doc may gain a pointer to the doc that revises it:

- **`Superseded-by: LLP NNNN`** — this doc/requirement is replaced.
- **`Extended-by: LLP NNNN`** — this doc is added to, not replaced.

Whole-doc scope goes in the header; a narrower scope is an inline note on the
applicable section. This keeps the corpus navigable *forward* without reopening
content. Engine interaction: a whole doc moved to `Superseded` status already
drops out of `needsCoverage` (it is no longer `live` — [LLP 0003 §Design-eligible](0003-coverage-and-change-sets.spec.md#design-eligible-llps-the-backlog)).
Sub-document supersession is **navigational only** — the engine stays
number-level, which is fine because the *new request* carries the trigger.

### Enforcement — seeded convention, review-checked

`neutral init` writes this rule as a managed block into the onboarded repo's
`CLAUDE.md` (`src/commands/init.js`, the `<!-- neutral:llp-conventions -->`
block). The **dual review** already checks a PR against the repo's `CLAUDE.md`
conventions, so a PR that edits the *decided content* of an Accepted/Active LLP —
beyond an editorial fix or a forward-ref — is caught **at review, with no new
engine code**. The seeded convention is the chosen enforcement; the `ref-check`
content-diff lint (Open questions) is an optional later belt-and-suspenders. This
extends `neutral init`'s onboarding ([LLP 0007 §neutral init](0007-config-and-onboarding.spec.md#neutral-init),
forward-ref'd there).

### Consolidation snapshots — the escape hatch

The cost of an append log is that "current truth" is a chain to read. When a
chain gets deep, **mint a fresh `spec` that supersedes the chain and restates the
current state** (the event-sourcing "snapshot"). You keep the full audit log
*and* gain one readable current-state doc. Cadence is author judgment.

## Consequences

- **The triggering problem dissolves, with no engine change.** Every increment is
  a request that rides the pipeline already built. The anchor machinery of the
  rejected option is not needed.
- **Provenance is first-class.** Each change is a dated, numbered, reviewable doc
  with a full `Draft → Review → Accepted` lifecycle and the whole toolchain
  (`llp-create`, `llp-review`, `ref-check`) — not a diff buried in git blame.
- **No drift hole, no design→code auto-loop to build.** Superseded content is
  replaced by a new request that flows through normally; the implementer that
  lands the new behaviour replaces the old code (and its `@ref`) as part of that
  work.
- **Minted designs/plans were already immutable-per-change-set.** Each change set
  is its own `design` + `plan` + `integration/<slug>` branch + PR
  ([LLP 0003 §The change set](0003-coverage-and-change-sets.spec.md#the-change-set)),
  so a revision is naturally a *new* change set, `Depends-on:` its predecessor.
  This decision mainly formalizes the human request/decision layer.
- **Reverses neutral's "living docs" house rule** (`CLAUDE.md`, updated in this
  same change) and aligns neutral with the upstream LLP grain.
- **Additive-coverage edge.** A new request that *reverses* already-built
  behaviour leaves the old code live until the implementer replaces it; mark the
  old requirement `Superseded-by:` so readers are not misled. The engine stays
  number-level, so no spurious churn.
- **Cost: current truth is a chain.** Mitigated by the forward-ref headers,
  consolidation snapshots, and `llp-orient` following the chain.

## Open questions

- **Enforcement (chosen: seeded convention + review).** `neutral init` seeds the
  rule into the repo's `CLAUDE.md`, and the dual review checks `CLAUDE.md`
  conventions — so violations are caught at review with no engine code (above).
  Still open: a `ref-check` lint that flags a non-editorial edit to an
  Accepted/Active doc by content-diffing its body against the merged version in
  git — a deterministic belt-and-suspenders to add if the review-only check
  slips.
- **Forward-ref vocabulary.** `Superseded-by` vs `Extended-by` vs a single
  `Revised-by`, and header vs inline for sub-document scope. Settle when
  `ref-check` learns to read them; until then they are prose.
- **Snapshot cadence.** Pure author judgment, or a chain-depth heuristic surfaced
  by tooling (`llp-orient`)?

## References

- [LLP 0003](0003-coverage-and-change-sets.spec.md) — the trigger surface a new request rides unchanged
- [LLP 0002](0002-ground-truth.principle.md) — coverage re-derived from the world, not stored
- [LLP 0001](0001-reconciler-architecture.decision.md) — fewer moving parts is the point; this adds none
