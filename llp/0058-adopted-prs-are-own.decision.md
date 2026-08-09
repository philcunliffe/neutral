# LLP 0058: Adoption ends foreignness — a pushable `neutral:adopt` PR is neutral's own

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-08-09
**Related:** 0000, 0017, 0019, 0024, 0025, 0030, 0032, 0037

## Context

LLP 0025 drove an adopted PR up the own-PR rung ladder but kept it `foreign` for its
whole life, preserving two deltas even in full-heal mode: the terminal was a verdict
label (`neutral:approved`, held for the maintainer to merge), and the review cap handed
residual findings back to the contributor instead of triaging (LLP 0017). In operation
the deltas contradict what the label means to its owner: `neutral:adopt` delegates the
PR's *care* (LLP 0024 — single-key, full-heal, including executing and modifying the
contributor's code), and the maintainer who delegated it still had to come back and
merge by hand — the exact toil the delegation was meant to end. The maintainer's word
(2026-08-09): **when a PR is adopted it should no longer be foreign.**

## Decision

<a id="adopted-is-own"></a>**A full-heal adoption is neutral's own PR.** An open PR
carrying `neutral:adopt` that is not review-only (LLP 0032) and that neutral can push
classifies with `foreign: false` and rides the own-PR ladder **end-to-end**: triage at
the review cap (LLP 0017), the `approved`-field `neutral:approved` sync (LLP 0030), and
the own terminal — `ready-hold`/`held`, or `merge` where the repo opted into automerge
(LLP 0019). Engagement is adoption (LLP 0037: observation *is* engagement), so the
classification applies from the first tick, not from the `neutral:adopted` stamp.

<a id="foreign-is-review-only"></a>**`foreign` now means exactly review-only mode.**
What stays foreign is the delegation neutral must not or cannot push: a
`neutral:review` grant (the narrower grant still wins when both labels are present,
LLP 0032), or an adopt fork with maintainer-edits off. Only there do the verdict
machinery (`approve`/`request-changes`, the `<!-- neutral-verdict -->` marker) and the
degraded observe-and-report rungs survive.

<a id="label-authorizes-terminal"></a>**The adopt label authorizes the terminal too.**
LLP 0000 §Autonomy's "readying/merging a contributor's PR is the maintainer's call" is
*answered by the maintainer's own label*: delegating a PR's care delegates its landing.
No autonomy widens beyond that word — an unlabelled foreign PR is still untouchable,
and a merge still happens only under the repo's explicit `automerge` opt-in, exactly as
for any own PR.

## Supersedes

Partially supersedes [LLP 0025](0025-adopt-foreign-prs.spec.md): its full-heal mode no
longer terminates in a verdict label, and its cap-time `request-changes` yields to
triage — both replaced by the own-PR ladder. Review-only mode, `canPush`, the verdict
markers, and the trigger/authorization model are unchanged. LLP 0037's engagement
stamp (`neutral:adopted`, set-if-absent at first observation) is unchanged and now
doubles as the visible record that the PR crossed into own-ladder care.

## Consequences

- `src/commands/prs.js` — `foreign = !own ∧ (review-only ∨ ¬canPush)`; rows gain an
  `adopted` field (a full-heal adoption riding the own ladder) for the `[adopt]` tag;
  the merged-sweep backstop rows report `foreign: false`.
- `src/prhealth.js` `foreignRung` — the pushable full-heal branches are unreachable
  (foreign ⇒ no push) and removed; the foreign ladder is pure observe-and-report plus
  review/verdict.
- Verdict markers already posted on open adoptions go stale harmlessly — the own
  ladder never reads them; the PR simply re-terminates as `held`/`ready-hold`/`merge`.
- An adopted draft is flipped ready at the terminal (`ready-hold`), like any own PR.
- Skill prose: the adopted-PR section and the never-ready/merge boundary re-scope to
  unlabelled foreign PRs and review-only delegations.
