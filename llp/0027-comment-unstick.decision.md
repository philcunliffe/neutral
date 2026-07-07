# LLP 0027: Comment-unstick — a human reply after the stuck report re-engages the PR

**Type:** Decision
**Status:** Accepted
**Systems:** Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-07
**Related:** 0000, 0002, 0009, 0017, 0018, 0026

## Context

Once `neutral:stuck` is set, the label is an unconditional short-circuit in
`selectRung`: present → `held`, full stop. When the human then does exactly what
was asked — answers the question, makes the design call, says "proceed" — neutral
does not notice. The PR is held until a human manually pulls the label, and even
then the ladder re-runs blind, without the guidance the human just gave. RFC 0018
names this gap and proposes a re-engagement path for *machine-watchable* blockers
(`blocked-on: #N`); it leaves the human case (`blocked-on: human`) with no signal.
But the human case *has* a ground-truth signal: **the human's reply itself**.

## Options considered

1. **A keyword command** (e.g. a comment containing `@neutral resume`). Precise,
   but adds protocol the human must remember, and the label already carries the
   authorization — the human was *asked* to respond on this thread, so a response
   is the signal. A human who wants to keep the PR held can say so or re-apply the
   label.
2. **Bare label removal as the signal.** Works today by accident, but loses the
   guidance-feeding step and asks the human to know neutral's label mechanics
   rather than just answering the question.
3. **Any qualifying comment after the stuck report, or a push (chosen).** The
   report (LLP 0026) is the baseline; anything the human does after it — reply or
   push — re-engages.

## Decision

The stuck short-circuit becomes **conditional on the observed comment thread**.
With the label present and a stuck report posted (LLP 0026), `selectRung` emits the
new terminal action **`unstick`** when either ground-truth signal holds:

- **A human reply** — a comment *after* the latest stuck report that is neither
  neutral's (its body carries a `<!-- neutral-… -->` marker — the discriminator,
  since neutral posts as the repo owner's account) nor a bot's (login ends
  `[bot]`).
- **A push** — the current head SHA differs from the SHA the latest report
  recorded. Neutral never pushes a held PR, so a moved head is human action.

Neither signal → `held`, exactly as today. No report at all → `stuck-report`
(LLP 0026) first, which establishes the baseline.

**Acting on `unstick`** is mechanical (no agent): remove the `neutral:stuck` label,
then post a marker-signed acknowledgement (`<!-- neutral-ack -->`) so the human
knows they were heard. Label removal is **tidy-up to match the predicate, not the
trigger** (the RFC 0018 discipline): the thread state is the truth. Next tick the
rung ladder runs the real rung at the current head.

**Guidance feeding.** The human's reply is not just a wake-up — it is the input.
`neutral prs` exposes a `guidance` count (human replies after the latest stuck
report); whenever it is non-zero, every worker dispatched for that PR (review,
triage, resolve-conflict, fix) is given the stuck report and all later human
comments in its prompt. If neutral gets stuck *again*, it posts a fresh report
(LLP 0026), which advances the baseline past the consumed replies — the loop is a
conversation, converging or honestly re-asking.

## Consequences

- `RungDecision` gains the terminal action `unstick`; the stuck branch of
  `selectRung` becomes a three-way classifier (`stuck-report` / `unstick` / `held`)
  over `PrObservation.comments` — pure, unit-tested offline.
- A held-and-reported PR is still `held` and still does **not** block idle
  (LLP 0013); the monitoring is free — the same `gh pr view` observation each tick.
  A pending `unstick` blocks idle for the one tick it takes to act.
- A comment that is *not* an answer (e.g. "hmm, let me think") still unsticks; the
  worst case is one honest re-stick with a fresh report asking again. Chosen over a
  keyword protocol — see Options.
- Replies via formal GitHub *reviews* are **not** observed (only the comment
  thread); the report tells the human to reply with a comment. Noted as a
  limitation, revisit if it bites.
- RFC 0018's `blocked-on: human` case is settled by this decision; the RFC's open
  ground remains the machine-watchable dependency case (`blocked-on: #N`) and the
  label rename.
- Stuck **issues** (issue-fix family) keep today's behaviour; extending
  comment-unstick to them is deferred with LLP 0026's issue-side report.
