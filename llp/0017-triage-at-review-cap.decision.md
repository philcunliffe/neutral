# LLP 0017: Triage at the review cap — defer non-blockers, stuck only true blockers

**Type:** Decision
**Status:** Accepted
**Systems:** Reviewer, Engineer
**Author:** Phil / Claude
**Date:** 2026-06-30
**Related:** 0000, 0002, 0008, 0009, 0015

## Summary

Extends the reviewed rung of [LLP 0009](./0009-maintenance-reconcilers.spec.md). When the
review fix-loop exhausts `maxReviewRounds` with the head still unreviewed, `reconcilePR`
used to **blanket-label the PR `neutral:stuck`** — parking it for a human regardless of
*why* the findings were unresolved. That conflates two different states: a finding that
**could cause a production defect** and a finding that is **just a review preference**.
The first genuinely cannot merge; the second should not strand an otherwise
mergeable-∧-green PR.

This decision inserts a **triage** step at the cap. Before parking, neutral re-judges the
*unresolved* findings against one test — *could this cause a defect in production?* — and:

- **All residual findings non-blocking** → defer them to a `neutral:fix` **follow-up
  issue**, comment the link on the PR, and let it **ship** (flip ready, hold for a human).
- **Any residual finding is a true blocker** → comment *why* it is a production risk and
  label `neutral:stuck`, exactly as before.

"Ship" never means merge — neutral still drives to *held for a human* and stops
([LLP 0000](./0000-neutral.explainer.md) §Autonomy). The deferred findings are not dropped:
they ride the **issue-fix** reconciler, so a deferred finding reaches neutral state only
when its `neutral:fix` issue has a fix attempt (the two invariants compose — LLP 0008).

## The triage judgment lives in the worker, not the classifier

"Could this cause a production defect?" is a judgment, so it stays **out** of the pure rung
classifier (`src/prhealth.js`). The classifier only **routes**: at the exhausted cap it
returns a new `triage` action in place of `stuck`. The worker makes the call and records
its outcome **in the world**, never a self-reported flag (LLP 0002):

- **Split** is recorded by a head-keyed marker `<!-- neutral-triage: <headSha> #M -->`
  (a sibling of the `neutral-review` marker). A triage marker covering the current head
  **satisfies the reviewed rung** — the PR becomes terminal (`ready-hold` → `held`). A new
  head leaves the marker stale and re-opens the rung, exactly as the review marker does.
- **Stuck** is recorded by the `neutral:stuck` label, whose existing short-circuit holds the
  PR for a human.

Because the rung is satisfied only by a marker *at the current head* (or the label), a
completed split or stuck never re-triages, and the marker doubles as the audit trail of
*which* head shipped with deferrals to *which* follow-up issue.

## All-or-nothing

A PR is split **only when every residual finding is non-blocking**. If even one is a true
blocker, the whole PR is `neutral:stuck` (the comment still lists the non-blockers, so the
human sees everything). Rationale: the PR cannot merge safely while a blocker stands, so
extracting the preferences into a follow-up buys nothing — the human is already looking at
the PR, and the residual blocker is the thing to resolve. One clear outcome per PR.

## Rejected

- **Blanket `neutral:stuck` at the cap (the status quo).** Treats a naming nit and a
  data-loss bug identically; strands safe PRs behind preference-only findings.
- **A self-reported "non-blocking" flag on the PR.** Would let an agent's prose decide
  "done" — the exact ground-truth violation LLP 0002 forbids. The split is instead a real
  GitHub issue plus a head-keyed marker, both re-derivable from the world.
- **Split the preferences even when a blocker remains.** Adds a follow-up issue and a
  comment to a PR that is stuck anyway; the preferences gain nothing until the blocker
  clears. All-or-nothing is simpler and surfaces one state.

## Constraints

- `@ref LLP 0009#pr-health-reconciler [constrained-by]` — extends the reviewed rung: the cap
  now routes to `triage`, which either defers non-blockers and ships or sets `neutral:stuck`.
- `@ref LLP 0002 [constrained-by]` — the split outcome is ground truth (a `neutral:fix` issue
  + a head-keyed triage marker), never a self-reported flag; the rung is keyed to the current head.
- `@ref LLP 0008 [constrained-by]` — composition: the follow-up rides the issue-fix invariant,
  so a deferred finding is only "done" once its issue has a fix attempt.
- `@ref LLP 0000 [constrained-by]` — §Autonomy holds: shipping means flip-ready + hold; neutral never merges.
- `@ref LLP 0015 [constrained-by]` — this decision is the new request that extends LLP 0009; the old spec gains a forward-ref, its decided content untouched.
