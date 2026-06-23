# LLP 0002: Ground truth, never self-report

**Type:** Principle
**Status:** Active
**Systems:** Core
**Author:** Phil
**Date:** 2026-06-23
**Related:** 0000, 0001, 0003

## Principle

A reconciler decides "is this done?" only by **re-deriving the fact from the
world**. It must never trust a status field, a metadata flag, or an agent's
prose claim. If a fact cannot be observed and re-derived, it is not a fact the
system may act on.

## Rationale

Every serious `testcity` incident reduced to a self-reported value that drifted
from reality: a merge SHA that pointed at no git object; a verdict invented when
a sub-step failed; a bead closed without its code landing. Self-reported state
is forgeable; ground truth is not. Deriving state instead of storing it removes
the forgery surface entirely and makes every reconcile pass idempotent.

## How to apply

- **Merged?** A task counts as merged only when its branch is a verified
  ancestor of the integration branch:
  `git merge-base --is-ancestor <branch> integration/<cs>`. After any
  agent-performed merge, the Engine re-verifies the reported SHA
  (`git cat-file -t <sha>` and the ancestor check) before treating it as landed.
  An agent reporting `merged=true` is a *hint to verify*, never a conclusion.
- **Covered?** An LLP counts as covered only when a real `@ref LLP NNNN`
  annotation in a design references it. The coverage check reads annotations,
  not a "designed" flag.
- **Ready?** The unblocked-open queue is computed from declared dependency edges
  plus the *derived* done-set — not from a tracker's `status=open`.
- **Reviewed?** A passing review is a structured verdict whose findings were
  each verified to be resolved in the *committed tree* (a green suite is not a
  landed fix); the Engine confirms the fix commit exists.
- **Observe immediately before acting.** Concurrent agents self-heal; re-read
  fresh state the moment before a mutating action, not minutes earlier.
- **Surface silent caps.** If a pass bounds its work (top-N, no-retry,
  sampling), log what was dropped. Silent truncation reads as "covered
  everything" when it did not.
