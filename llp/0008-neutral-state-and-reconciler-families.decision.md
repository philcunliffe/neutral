# LLP 0008: Neutral state — reconciling repository ground truth, not only LLP requests

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-25
**Related:** 0000, 0001, 0002, 0003, 0007, 0010

## Context

LLP 0000 defines neutral as a system that takes *request LLPs* out of Draft and
drives them through design → plan → implement → PR → review. All of the original
reconcilers are triggered by a request LLP, and the change-set model (LLP 0003)
assumes every PR descends from a `design`+`plan` pair.

Three new capabilities have **no LLP at their root**:

- **Adopt** — review and (when pushable) heal a *foreign* pull request a human
  marked `neutral:adopt`. No request, design, plan, or change set.
- **Self-heal** — keep a pull request mergeable and green, not only reviewed.
- **Issue-fix** — attempt a fix for an *issue* a human marked `neutral:fix`,
  skipping the design→plan machinery entirely.

These do not fit the five-reconciler table or the change-set DAG. The choice:
force every adopted PR and bug issue to first become a request LLP, or widen what
neutral reconciles.

## Options considered

1. **Stay strictly LLP-triggered.** Require a request LLP for every adopted PR and
   every bug before neutral may act. Keeps a single intake, but imposes
   heavyweight ceremony on work that is not a request you authored (a
   contributor's PR), and re-introduces a human-authored artifact as the gate for
   what is meant to be automatic.
2. **Widen the charter to repository ground truth (chosen).** Neutral reconciles a
   repository toward a desired base state from observed git/GitHub ground truth;
   the LLP→PR pipeline is one *family* of reconcilers, PR-health and issue-fix are
   another.

## Decision

Neutral's purpose is to return a repository to **neutral state** and hold it
there. A repository is in neutral state when every gap neutral can close
*autonomously* is closed — concretely, when:

- no live request LLP is uncovered (the pipeline invariants, LLP 0003);
- no `neutral:fix` issue lacks a fix attempt (a `Fixes #N` PR, or a documented
  `neutral:stuck`);
- no in-scope pull request is unmergeable, failing checks, or unreviewed (in scope
  today: neutral's *own* change-set and fix PRs — see Scope).

Neutral state is the **fixed point of autonomous reconciliation**: it stops at the
boundary of what only a human may do. The one irreversible act — merging — is
never neutral's; it drives every artifact to *held, review-passing, healthy* and
waits (LLP 0000 §Autonomy). "No unresolved request" therefore means "every
request has a held PR," not "every request is merged."

> **Extended-by [LLP 0019](0019-automerge.decision.md):** a repo owner may move
> this boundary per repo — the opt-in `automerge` config flag lets the terminal
> rung merge a finished PR instead of holding it. Default unchanged (hold).

Reconcilers split into two families, sharing one spine:

- **Pipeline family** — intake is a request LLP; output is a held change-set PR.
  Governed by the coverage invariant and change-set DAG (LLP 0003). Unchanged.
- **Maintenance family** — intake is an existing GitHub artifact a human delegated
  by label (`neutral:adopt` PR, `neutral:fix` issue); output is a healthy,
  reviewed PR held for a human. **Not** part of the change-set DAG.

The shared spine, identical for both families: ground truth only (LLP 0002), the
`reconcilePR` review/heal unit, and *hold for a human, never merge*
(LLP 0000 §Autonomy). The companion Spec (LLP 0009) enumerates the maintenance
base states, triggers, and the `reconcilePR` rungs.

## Scope

The maintenance family as built covers neutral's **own** pull requests (change-set
and fix PRs) for health and review, and `neutral:fix` issues. Adopting **foreign**
pull requests (a `neutral:adopt` label, and the fork push-access handling it
requires) is **deferred** until the repo has external contributors — handled
manually until then. The charter admits adopted PRs; the spec simply does not build
them yet. This keeps every in-scope PR one neutral can always push to, dropping
`canPush` detection and the unpushable-fork case entirely.

## Consequences

- LLP 0000's identity and reconciler table gain the maintenance family and the
  neutral-state definition; the Systems map gains the maintenance system(s).
- LLP 0002 gains new ground-truth predicates (mergeable, checks-green, bug-fixed)
  and the rule that an *unobservable-yet* signal (a PENDING check, an UNKNOWN
  mergeability) means "wait", not "false".
- The scope rule generalizes: neutral acts only on work explicitly delegated to it
  — by minting it (`Generated-by: neutral`, LLP 0007) or by a human labelling a
  foreign artifact (`neutral:*`). The label is the authorization.
- The change-set model (LLP 0003) is untouched: maintenance PRs are a separate
  axis. A merged fix still contributes coverage only through the existing
  code-`@ref` path, never through the DAG.
