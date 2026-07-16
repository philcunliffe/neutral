# LLP 0032: `neutral:review` — review-only delegation

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-16
**Related:** 0002, 0009, 0024, 0025

## Context

`neutral:adopt` is single-key, **full-heal** authorization (LLP 0024): neutral will push
merge-bases, conflict resolutions, CI fixes, and review-finding fixes to the
contributor's branch whenever it can. Sometimes a maintainer wants less — *review this
PR, tell me and the contributor what you find, but keep your hands off the branch*. The
only way to get that today is the accident of push access: review-only mode
(LLP 0025) engages only when neutral *cannot* push. There is no way to ask for it.

## Decision

<a id="review-label"></a>**A foreign PR labelled `neutral:review` enters scope in
review-only mode, regardless of push access.** The trigger set becomes own ∪
`neutral:adopt` ∪ `neutral:review`. The label is the maintainer's authorization exactly
as `neutral:adopt` is (LLP 0024) — just a narrower grant: neutral reviews the head,
posts the verdict (`neutral:approved` / `neutral:changes-requested`, with the
head-keyed verdict marker), and **never pushes** to the branch.

<a id="reuse-review-only"></a>**No new ladder — the label forces the existing mode.**
LLP 0025's degraded ladder already has review-only semantics (heal rungs degrade to
`request-changes`, review runs in full, verdict terminal); it was just selected by
`!canPush`. The mode selector becomes: **review-only ⇔ `neutral:review` ∨ ¬canPush**.
In code this is one clause: `foreignRung` computes its effective `canPush` as
`observed-canPush ∧ ¬reviewOnly`. Every downstream behaviour — the verdict labels, the
head-keyed marker, the review-cap exemption (review-only never fixes, so it reviews
rather than `request-changes` at the cap) — is inherited verbatim.

<a id="restrictive-wins"></a>**When both labels are present, `neutral:review` wins.**
A delegation must never widen implicitly: contradictory labels resolve to the narrower
grant. To upgrade a reviewed PR to full heal, the maintainer removes `neutral:review`
(or replaces it with `neutral:adopt` alone) — an explicit act, matching LLP 0024's
single-key model where the label *is* the authorization.

<a id="own-prs-skip"></a>**On an own PR the label is redundant — ownership wins.**
Own PRs are already reviewed by their own ladder (rung 3); a `neutral:review` label on
one is ignored, exactly as `neutral:adopt` is at enumeration (LLP 0025).

## Rejected

<a id="config-rejected"></a>**A repo-level `adoptReviewOnly` config flag, rejected
(for now).** LLP 0025 already noted the config shape; but the ask here is per-PR, and a
label keeps the grant visible on the artifact it governs, togglable by the maintainer
without a commit. A repo-wide flag can still come later; it would compose as a default,
not replace the label.

<a id="new-ladder-rejected"></a>**A separate review-only ladder or new terminal,
rejected.** Review-only already exists and is tested; a second path would drift. The
label is a mode *selector* into LLP 0025's machinery, nothing more.

## Consequences

- `REVIEW_LABEL` joins the label constants in `src/config.js`.
- `PrObservation` (`src/types.d.ts`) gains `reviewOnly?: boolean`; `src/commands/prs.js`
  widens the scope filter to own ∪ adopt ∪ review, sets the flag, and surfaces it in
  `neutral prs` (`[review]` tag / JSON field). `foreignRung` (`src/prhealth.js`) folds it
  into the effective `canPush`.
- A merged `neutral:review` PR gets **no** `neutral:adopted` completion record — it was
  never adopted (LLP 0031 keys on `neutral:adopt` alone).
- The `/neutral-init` skill creates the `neutral:review` label; the reconcile skill's
  adopted-PR section covers the `[review]` tag.
- [LLP 0025](0025-adopt-foreign-prs.spec.md)'s trigger section gains an
  `Extended-by: LLP 0032` note.
