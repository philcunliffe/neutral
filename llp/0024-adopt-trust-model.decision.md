# LLP 0024: The `neutral:adopt` label authorizes full heal of a foreign PR

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-07
**Related:** 0000, 0002, 0008, 0009, 0025

## Context

LLP 0008 widened neutral's charter to admit *foreign* pull requests — ones neutral
did not author — that a human marks `neutral:adopt`, and stated the general rule that
**"the label is the authorization."** LLP 0009 sketched the build and deferred it.

Un-deferring (LLP 0025) forces a question 0008 left implicit. Acting on a foreign PR
is not like acting on foreign *metadata*: to heal one, neutral **checks out and runs
untrusted contributor code** — resolving a conflict and running the project's tests
locally before pushing, fixing CI from failing logs, dispatching review/fix agents over
the diff, and pushing commits back to the contributor's branch. That is a materially
different trust posture than neutral's own PRs. What, exactly, does the maintainer's
label authorize?

## Options considered

1. **Label authorizes full heal (chosen).** `neutral:adopt` — which only a maintainer
   can apply — authorizes the same heal+review ladder neutral runs on its own PRs
   (LLP 0009), degrading to review-only exactly when neutral *cannot push* (the fork's
   `maintainerCanModify` is off). One key. The maintainer vouches for the code by
   labelling it, identical in kind to `neutral:fix` on an issue or `Generated-by:
   neutral` on a minted design (LLP 0008).
2. **Review-only, always.** `neutral:adopt` only ever runs the review and posts a
   verdict; neutral never pushes or executes foreign code beyond what CI already runs.
   Safest, but leaves every rebase / conflict / CI-fix a manual maintainer job forever
   and makes "adopt" a *reviewer*, not the *reconciler* the charter promised.
3. **Two-key.** Review by label; healing needs a second signal (a known collaborator, or
   a `neutral:adopt-heal` label). More cautious, but splits the authorization model —
   issues and own-PRs are one-key — and adds ceremony to a flow whose whole value is
   one-label delegation.

## Decision

`neutral:adopt` is a **single-key, full-heal** authorization. Neutral runs the same
`reconcilePR` rung ladder it runs on its own PRs, degrading to **review-only** only
where push access is absent (LLP 0009). The label is the trust boundary; the maintainer
who applies it vouches for running the contributor's code.

The residual risk — a maintainer mislabels a hostile PR — is bounded by the invariant
that already bounds every neutral act: **neutral never merges** (LLP 0000 §Autonomy).
The worst case is a reviewed, healed, *held* PR a human must still merge; foreign code
never reaches the default branch autonomously. CI secret-exposure is a property of the
repo's own trigger config (`pull_request` vs `pull_request_target`), unchanged by adopt
— neutral triggers no run a labelled PR would not already trigger.

## Consequences

- The adopt spec (LLP 0025) builds `canPush` detection and a review-only *degradation*,
  **not** a second authorization gate.
- LLP 0008's scope rule — "neutral acts only on work explicitly delegated, by minting it
  or by a label" — now explicitly covers **executing and modifying** foreign code, not
  only acting on foreign metadata.
- A repo that wants review-only adoption gets it as a future opt-in config knob (mirroring
  `automerge`, LLP 0019), never the default — noted, not built.

## Constraints

- `@ref LLP 0008 [constrained-by]` — extends "the label is the authorization" to cover
  executing/modifying foreign code; single-key, consistent with `neutral:fix`.
- `@ref LLP 0000 [constrained-by]` — never-merge is what bounds a mislabel's blast radius;
  adopt does not move the autonomy boundary.
- `@ref LLP 0002 [constrained-by]` — the heal is a real pushed commit / re-run check and
  the verdict a real review, each re-derived from git/`gh`, never a self-reported field.
