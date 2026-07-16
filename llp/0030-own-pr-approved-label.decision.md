# LLP 0030: Own PRs carry `neutral:approved` at their reviewed-clean terminal

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-15
**Related:** 0002, 0009, 0025, 0028

## Context

`neutral:approved` was foreign-only ([LLP 0025](0025-adopt-foreign-prs.spec.md)): an adopted
contributor PR gets the label because neutral cannot ready or merge someone else's PR, so a
label is its only terminal signal. Neutral's **own** PRs (`integration/*`, `fix/issue-*`)
instead terminate at `ready-hold` — flip draft→ready and hold — and carried no label. The
draft→ready flip plus the marker-signed review record ([LLP 0028](0028-review-record-comment.decision.md))
*is* the "reviewed clean" evidence, but it is not visible at a glance in a PR list. A
maintainer scanning open PRs wants the same one-look "this passed neutral's review" signal on
own PRs that adopted PRs already have.

The reason own PRs were left unlabelled was the staleness hazard: a plain label does not carry
a head SHA, so a label added once and left in place would wrongly imply an unreviewed commit
was approved after the head moves. That objection is real, but it is an argument for keeping the
label **head-accurate**, not for omitting it.

## Decision

<a id="own-pr-approved"></a>**An own PR carries `neutral:approved` exactly when its current
head is at the reviewed-clean terminal** — mergeable ∧ green ∧ reviewed, not stuck (the
`ready-hold`, `held`, and `merge` actions). The label is added there and **removed the instant
the PR leaves that state**.

<a id="cli-decides"></a>**The CLI decides, the skill applies** (LLP 0002). `selectRung`
(`src/prhealth.js`) sets `approved: true` on exactly the three own-PR reviewed-clean terminal
returns; every other decision (every heal/review/stuck/triage rung, and every foreign PR)
omits the field. The reconcile skill syncs the label to that field each tick — mechanical, no
agent, idempotent: add `neutral:approved` iff `approved` and absent, remove it iff not
`approved` and present. Because the field is recomputed from git ground truth every tick, the
label tracks the current reviewed-clean head and **cannot go stale**: when master advances and
an approved PR goes `BEHIND`, its next-tick action is `merge-base` (no `approved`) and the sync
strips the label until the rebased head is re-reviewed clean and returns to `ready-hold`/`held`.

<a id="no-body-marker"></a>**No body verdict marker for own PRs.** A foreign PR persists its
verdict in a head-keyed `<!-- neutral-verdict: <sha> -->` body marker for idempotency, because
neutral cannot push to the fork and must not re-label a settled head. An own PR needs no such
record: neutral keeps it rebased and re-derives its terminal from git every tick, so the
`approved` field *is* the idempotency source and the label is a pure projection of it. This
keeps the own-PR path free of a second persisted artifact (LLP 0002 — no self-reported tally).

## Rejected

<a id="add-only-rejected"></a>**Add-only (label once, never remove), rejected.** Simpler, but
it reintroduces exactly the staleness the foreign path was careful to avoid: an approved PR
that goes `BEHIND` or gets a pushed commit would keep a green label over an unreviewed head.
The label must mean "the current head is reviewed clean" or it means nothing.

<a id="changes-requested-rejected"></a>**A negative `neutral:changes-requested` on own PRs,
rejected (for now).** A blocked own PR already carries `neutral:stuck` (LLP 0026), which is the
own-PR "a human must act" signal; a second negative label would duplicate it. `changes-requested`
stays the foreign-PR verdict where the ball is in the *contributor's* court (LLP 0025).

## Consequences

- [LLP 0025](0025-adopt-foreign-prs.spec.md)'s "verdict label, not a merge" terminal section
  gains an `Extended-by: LLP 0030` note: `neutral:approved` is no longer foreign-only.
- `RungDecision` (`src/types.d.ts`) gains an optional `approved` field; `neutral prs --json`
  surfaces it (the `{...decision}` spread in `src/commands/prs.js`).
- The target repo needs a `neutral:approved` label; the skill creates it once if absent
  (`gh label create`), the same way adopted-PR labels are assumed to exist.
- No change to what "reviewed" means (LLP 0028/0029) or to any gate: the label is a visible
  projection of a terminal neutral already computed.
