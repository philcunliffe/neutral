# LLP 0019: Opt-in automerge — the terminal rung may merge when the repo says so

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-03
**Related:** 0000, 0002, 0007, 0008, 0009, 0015

## Context

The shared spine of both reconciler families is *hold for a human, never merge*:
LLP 0008 makes merging "the one irreversible act — never neutral's", and
LLP 0009's terminal rung flips a finished PR ready and holds it. That is the
right default — but on a repo where the human's merge is a rubber stamp (solo
project, low-stakes repo, the review rung is the real gate), the hold is pure
latency: every change set and fix waits on a click that adds no scrutiny.

## Options considered

1. **Keep hold-only.** Safe, but the human becomes a queue worker on repos where
   they add nothing at the merge step.
2. **GitHub native auto-merge** (`gh pr merge --auto`). Delegates the "when" to
   GitHub, but it is meaningful only with branch protection configured, and it
   detaches the merge from the tick — neutral could no longer key follow-up
   observation (handoff, dependent unblocking) to an action it took.
3. **An opt-in config flag that changes the terminal rung (chosen).** The repo
   owner states the policy once, in the tracked config; the rung ladder stays the
   single decision point and the tick stays the actor.

## Decision

A boolean **`automerge`** field in `.neutral/config.json` (default **`false`** —
extends the LLP 0007 config surface). When `true`, `selectRung`'s **terminal**
rung — a PR that is *mergeable ∧ green ∧ reviewed at the current head SHA* —
emits the action **`merge`** instead of `ready-hold`/`held`: the orchestrator
flips a draft ready (`gh pr ready`) and **squash-merges** it (`gh pr merge
--squash`), the same squash-only-at-the-final-PR rule as the human merge
(LLP 0003).

Everything upstream of the terminal rung is unchanged — automerge **relaxes the
hold, never the gates**:

- The three rungs must all hold at the **current** head SHA (LLP 0002); a stale
  review or a pending check still waits.
- `neutral:stuck` still wins over every rung — a held PR is never automerged.
- Scope is unchanged: only neutral's own `integration/*` and `fix/issue-*` PRs
  (LLP 0008 §Scope).
- The merge happens through `gh`, so GitHub re-checks branch protection at merge
  time; a policy-blocked merge fails loudly and the PR simply stays open for the
  next tick.

`Superseded-by`/`Extended-by` framing: this does **not** overturn LLP 0008's
autonomy boundary — it lets a repo owner *move* the boundary, explicitly and per
repo, via a tracked file that is itself reviewed like any other change.

## Consequences

- LLP 0008 §Decision and LLP 0009 §Terminal gain an `Extended-by: 0019`
  forward-ref: "never merge" becomes "never merge *unless the repo opted in*".
- `NeutralConfig` gains `automerge`; `selectRung` gains a third parameter and a
  new terminal action `merge`; `neutral prs` threads the flag through.
- Idle semantics are untouched: `merge` is not `held`, so a tick with a pending
  automerge is not idle; once merged the PR leaves the open set and the existing
  handoff logic (branch deletion, dependent unblocking) runs off git ground
  truth exactly as for a human merge.
- The one-merge-flow-per-integration-branch lock (LLP 0003/0010) already
  serializes the fan-in, so an automerge cannot race a same-branch worker.
