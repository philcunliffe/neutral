# LLP 0021: Retry escalation — a tier's exhausted attempt budget climbs the model ladder

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-03
**Related:** 0002, 0009, 0020, 0022

## Context

With verifier-gated tiering (LLP 0020), first attempts at gated work run on the
mechanical tier. Neutral already retries that work under bounded counters —
K attempts per task before `neutral:stuck` (the implement worker),
`maxReviewRounds` per PR (LLP 0009), the rung ladder's re-observation every
tick — but a retry today re-runs the **same** model against work that has
already defeated it once. The bound then just measures how many times the same
capability fails before a human is paged.

But escalating on the *first* failure over-reads a single miss. A gated failure
has two very different causes: a **transient** one — a flaky test, a race, a
network blip, one bad sample from a capable model — where the same tier would
succeed on a re-roll; and a **capability ceiling** — the tier genuinely cannot
land this task — where re-rolling the same tier is wasted spend. A single
failure cannot tell them apart. Repeated failure at one tier can: a model that
misses N times in a row is hitting a ceiling, not unlucky N times.

## Options considered

1. **Fixed tier per stage; retries repeat it.** Simple, but the retry adds no
   new capability — for genuinely hard tasks the K attempts are K identical
   failures, and the stuck label arrives no better informed.
2. **Guess complexity up front and route the first attempt.** Already rejected
   as option 2 of LLP 0020 — there is no reliable pre-attempt signal.
3. **Escalate on the first verified failure.** The attempt count — already
   derived from ground truth, since a "failed attempt" is a claim the tick
   re-derives from git/CI before counting it (LLP 0002) — indexes the ladder,
   one failure per rung. Cheap, but climbs on a single miss, so one flaky
   failure jumps a task to a costlier tier it never needed.
4. **Escalate when a tier exhausts a per-tier attempt budget (chosen).** Give
   each tier a budget of **M** verified attempts; climb only after M failures
   *at that tier*. The budget absorbs transient failure (a re-roll at the same
   tier) and reserves escalation for a demonstrated capability ceiling. It still
   costs nothing on the happy path — a task that lands first try never retries —
   and spends the costly tiers only on work that has repeatedly, verifiably
   resisted the cheaper ones.

## Decision

Wherever a stage retries under a **ground-truth-derived attempt count**, each
tier gets a **per-tier attempt budget M**: the task retries at its current tier
until M verified failures accumulate *there*, then climbs **one tier** on the
LLP 0020 ladder (mechanical → worker → judgment) with its per-tier count reset,
capping at the judgment tier. When the judgment tier exhausts its budget the
task is `neutral:stuck`. The strongest model is thereby spent only on work that
*repeatedly, verifiably* resisted the cheaper tiers — never on a single miss.

**M is a per-tier tunable** (a named constant, like `maxReviewRounds` and the
autophagy threshold — LLP 0009/0013), not a design unknown. The default is
generous where retries are cheapest and tighter as they get dear —
**mechanical 5, worker 3, judgment 2** — so a flaky mechanical task re-rolls
freely while a judgment-tier task that misses twice pages a human rather than
burning the most expensive model. A single flat M is a valid config too.

In scope now, because the counter already exists:

- **Task implementation**: the entry rung is the task's planner-rated tier
  (LLP 0022; unrated reads as mechanical). The task retries there up to M(tier)
  times; on the M-th verified failure it climbs one rung and the count resets;
  judgment-tier exhaustion is `neutral:stuck`. The wave loop holds the
  per-(task, tier) count **in-memory for the run** and increments it only when
  the wave's re-derive-ready confirms from git that the task did **not** land —
  so every increment is a ground-truth failure, never a self-report (LLP 0002).
- **Review-fix rounds** (`maxReviewRounds`): here the per-tier budget is **1** —
  each round's fix agents run one tier above the last. `maxReviewRounds`
  (default 2) is already a tight external cap, so there is no room for
  within-tier re-rolls; the round number *is* the tier index.

Out of scope until a counter exists in ground truth: **fix-ci** re-attempts.
The rung re-observes each tick but nothing durable counts prior attempts at a
given head; inventing a side-ledger for one would violate LLP 0002. If a
ground-truth derivation appears (e.g. failed runs on the current head), fix-ci
joins the ladder under this same decision — no new decision needed.

**Ground truth and recycle.** The per-tier tally lives only in the implement
Workflow run's memory, never in a durable ledger — and that is safe because a
context-autophagy recycle fires **only at idle end-of-tick, never mid-run**
(LLP 0010/0013), so no recycle can strand a count. Each increment is gated by a
fresh git re-derivation of "did not land," so the *fact* of each failure is
ground truth even though the *tally* is ephemeral. If a run dies, the next
tick's fresh run re-derives done from git and restarts counting — wasting at
most a few cheap attempts, never corrupting what counts as done.

Escalation changes **which model retries, never what counts as done**: every
gate of LLP 0002/0009 (verified ancestry, CI at the current head, the
failing-then-passing test) applies identically at every tier.

## Consequences

- The implement Workflow's wave loop carries a per-(task, tier) attempt count
  and maps the current tier to `agent({ model })`; the skill's re-dispatch
  instructions and `neutral start` document the budgets. Both `@ref` this
  decision. This **supersedes the flat K=3 task bound**: the stuck threshold is
  now the sum of the per-tier budgets from the entry rung up, not a single K.
- The worst-case attempt count is bounded and cost-shaped: a mechanical-entry
  task stuck-out runs at most 5 + 3 + 2 = 10 attempts (defaults), but 8 of them
  are on the two cheaper tiers — the judgment model runs at most twice before a
  human is paged. A judgment-entry task (planner-rated 5) runs at most 2.
- Stages that start at the judgment tier (Designer, Impl-designer, triage —
  LLP 0020) have no ladder above them; their retries repeat the tier until the
  stage's own bound (or its budget) ends in `neutral:stuck`.
- A `neutral:stuck` label now certifies the work exhausted the *judgment* tier's
  budget, not merely a cheap tier's — the human is paged only after the strongest
  model has itself repeatedly, verifiably failed.
