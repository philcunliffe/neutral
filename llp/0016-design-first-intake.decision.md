# LLP 0016: Design-first intake — an Accepted design is a build order

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-06-26
**Related:** 0002, 0003, 0008, 0013, 0015

## Summary

Extends the coverage model of [LLP 0003](./0003-coverage-and-change-sets.spec.md) with a
second way work enters the pipeline. Until now the only intake was a **request**
(`spec`/`rfc`/`issue`): the Designer turns it into a `design` on an `integration/<slug>`
branch, the Impl-designer adds a `plan`, the Implementer builds it. A design authored by
hand and **merged straight to the target branch** matched no trigger — it is not a request
(so `neutral backlog` is empty), and the implement stages only ever looked at neutral's own
designs on integration branches. Worse, a design LLP present on the target was neutral's
signal for *already shipped*, so a doc-first merge read as **done** with no code behind it.

This decision adds **design-first intake**: a human does the Designer's job (writes the
design), and neutral does the rest — *skipping the first step*.

## Intake

A `design` LLP on the target branch at **`Status: Accepted`** with no `integration/<slug>`
branch yet is **implementable**: neutral seeds the change set, mints the `plan`, and runs
the existing Implement → reconcilePR flow against it. No preceding request is required.

The **`Accepted`/`Active` status is the trigger**, and it is exactly the documented
lifecycle (LLP 0015): *Accepted = approved for implementation*, *Active = built and merged*.
Two consequences make this safe and self-scoping:

- neutral mints its **own** designs `Active` from the start, so they never match the
  `Accepted` trigger — design-first intake therefore picks up **only** human-authored,
  approved-but-unbuilt designs. No `Generated-by` gate is needed (and gating on it was the
  *wrong* fix — see Rejected).
- Once an `integration/<slug>` exists the design is in flight (reconcilePR/Implement own it);
  once the design flips to `Active` on the target it is shipped. So the trigger is edge-true
  exactly once, between "approved" and "built".

Surfaced deterministically by `neutral implementable [--json]` (mirrors `neutral backlog`);
it is a pipeline-family blocker in the idle predicate ([LLP 0013](./0013-context-autophagy.spec.md)),
so the loop does not go idle (or recycle) while an approved design is owed an implementation.

## Shipped is Active

A change set counts as **merged to target only when its `design` LLP is `Status: Active`**
on the target — not on mere file presence. An `Accepted` design on the target is
approved-but-unbuilt (design-first work in progress), not shipped; the implementation PR
flips it `Accepted → Active` (a lifecycle transition, not a content edit, so the
immutability rule of LLP 0015 is preserved). This is what lets a design land doc-first
without the reconciler concluding the change set is done.

## Rejected — "just drop the Generated-by filter"

The filter (`isNeutralDesign`) is **not** the gate that blocks design-first work, and
removing it alone fixes nothing: the implement stages scan `integration/*` branches, and a
design-first design lives on the target, so the filter is never even evaluated for it.
Removing it *and* broadening the scan to the target would flag every historical `Active`
design as needing a plan, and a design on the target also reads as shipped — false positives
plus a contradiction. The real discriminator is **status** (`Accepted` vs `Active`), which
this decision adopts; the `Generated-by` distinction becomes redundant.

## Constraints

- `@ref LLP 0003 [constrained-by]` — extends the coverage/change-set model with a second intake.
- `@ref LLP 0015 [constrained-by]` — Accepted/Active is the lifecycle this keys on; Accepted→Active on build.
- `@ref LLP 0002 [constrained-by]` — the trigger is read from git ground truth (the target branch), never self-report.
- `@ref LLP 0008 [constrained-by]` — neutral state now also requires no implementable design outstanding.
