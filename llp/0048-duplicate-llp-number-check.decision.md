# LLP 0048: Duplicate LLP numbers — a merge-blocking CI check, not a claiming system

**Type:** Decision
**Systems:** Core
**Status:** Active
**Author:** Phil / Claude
**Date:** 2026-07-30
**Related:** 0002, 0007, 0015

## Context

Loops running 24/7 against several repos mint LLPs concurrently on disjoint
`integration/*` branches. Each branch's own tree is internally consistent
(ref-check's uniqueness check is single-worktree), the two docs have different
slugs so their filenames never conflict, and git merges both branches cleanly —
so two docs sharing one number land in the default branch **silently**. This
happened in practice: hypaware (0098, 0099, 0111), hypaware-server (0020–0022).
Once duplicated, every `@ref LLP NNNN` in code and docs is ambiguous.

## Decision

### Check over claiming

**Detect from the merged tree; never reserve.**
The invariant "LLP numbers are unique across the tree" is enforced by a CI check
that fails when two docs under `llpDir` (tombstones included, `reviews/`
excluded) share a `NNNN` filename prefix. The duplicate is *derived from the
tree the merge would produce* — ground truth (LLP 0002) — and the red check is
already the reconciler's prompt to act: the PR-health `green` rung dispatches
`fix-ci` on any failing rollup, so no new mechanism is needed. A number
*claiming* system was rejected as a ledger: an agent writing "I own 0048"
somewhere is self-report, with stale-claim failure modes (a dead loop holding a
number) and a new coordination surface across branches and repos.

### Generated workflow

**`neutral init` seeds the check.** Onboarding
writes `.github/workflows/llp-check.yml` (idempotent — never overwrites an
existing file, same `ensure` contract as config/baseline). The check is pure
POSIX shell over filenames — language-agnostic, no dependence on the target
repo's toolchain — and runs on `pull_request` (GitHub runs it against the merge
preview of PR into base) **and** on `push` to the default branch, so a duplicate
that slips through anyway turns the default branch red where a human or loop
sees it, instead of sitting silent.

### Renumber fix

**The fix is renumber-the-later-doc.** When the check
fails, the doc whose number landed *second* moves to the next free number across
the default branch **and** all `integration/*` branches, and the `@ref`s that
meant it are updated. Caution baked into the failure message: refs to a
duplicated number are *ambiguous, not dangling* — they still resolve, to the
wrong doc — so ref-check will not flag them; the renumbering agent must find and
retarget them itself. Numbers are never reused (LLP 0015), so tombstones count
toward "free".

### Stale green

**Residual race, handled operationally.** A PR's green
check is computed against a merge preview that goes stale the moment another PR
lands the same number in the base. Closing that window requires the branch to be
current with base at merge time — either GitHub branch protection ("require
branches to be up to date") or neutral's own `merge-base` rung, which refreshes
a `BEHIND` branch and thereby re-triggers the check against the new base. The
`push`-trigger backstop covers whatever still slips.

## Rejected

### Claiming rejected

**Number reservation.** A claims registry (file in
the default branch, git notes, an external allocator). Serializing claims
through the default branch is technically ground truth, but it adds merge
latency and a coordination mechanism whose only job is preventing a condition
the check detects for free — and every non-serialized variant is a ledger.

### Prevention only rejected

**Smarter minting alone.** The Designer
already numbers cross-branch ("one past the highest across `<DEFAULT>` and all
`integration/*`") and the Impl-designer now gets the same rule — but prompts are
not invariants: two workers can still race the same instant, and humans mint by
hand. Prevention lowers the collision rate; only the check makes the invariant
hold.

## Realization

- `src/commands/init.js` — `llpCheckWorkflow(llpDir)` (pure, tested) generates
  the workflow; `initCommand` writes it via `ensure`.
- `.claude/skills/neutral-init/SKILL.md` — the workflow in the scaffold step;
  preflight renumbers pre-existing duplicates so the check lands green.
- `.claude/skills/neutral-reconcile/SKILL.md` — the Impl-designer inherits the
  Designer's cross-branch numbering rule.

Code realizing this decision annotates `// @ref LLP 0048#<anchor> [implements]`.

## References

- [LLP 0002](0002-ground-truth.principle.md) — why detection from the merged
  tree beats a claims ledger
- [LLP 0007](0007-config-and-onboarding.spec.md) — the `neutral init` scaffold
  this extends
- [LLP 0015](0015-immutable-llps.decision.md) — numbers are never reused;
  tombstones stay in the namespace
