# LLP 0022: Planner-rated complexity seeds the first-attempt tier

**Type:** Decision
**Status:** Draft
**Systems:** Core, Engine, Engineer
**Author:** Phil / Claude
**Date:** 2026-07-03
**Related:** 0002, 0003, 0020, 0021

## Context

LLP 0020 tiered dispatch by verifier coverage and rejected (its option 2)
routing by guessed difficulty; LLP 0021 then starts every task at the
mechanical tier and climbs on verified failure. But a plan's tasks are not
uniform: a genuinely hard task predictably burns attempt 1 — and a slice of
the K=3 bound — on a model that was never going to land it, while the wave
loop waits on the failure to learn what the plan already knew.

There *is* one place a difficulty signal exists before any attempt: the
**Impl-designer**, at plan time. It runs on the judgment tier (LLP 0020), has
just decomposed the design into the task DAG, and is not grading its own
future work — the opposite of the dispatch-time self-estimate option 2
rejected.

## Options considered

1. **Uniform mechanical entry (LLP 0021 as first drafted).** Simple, no new
   grammar; but hard tasks spend their first verified failure re-discovering
   a fact the planner had in hand.
2. **Rate at dispatch time.** The orchestrator or worker estimates before each
   attempt. The dispatcher lacks the design context; the estimate is
   unrecorded and unreviewable — the self-report flavor LLP 0020 rejected.
3. **Planner rates each task at plan time, recorded in the plan LLP
   (chosen).** The judgment tier rates with full design context, once, into a
   tracked and reviewable artifact; the rating only seeds where a task
   *enters* the LLP 0021 ladder.

## Decision

The Impl-designer rates every task's **complexity, an integer 1–5**, on the
task line of the plan LLP — extending the LLP 0003 §Tasks grammar with an
optional field:

```
## Tasks
- id: T1  branch: task/<slug>/T1  deps: []    complexity: 2  -- brief
- id: T2  branch: task/<slug>/T2  deps: [T1]  complexity: 5  -- brief
```

The rating maps to the first attempt's tier on the LLP 0020 ladder:

- **1–3 → mechanical** (currently Sonnet 5)
- **4 → worker** (currently Opus 4.8)
- **5 → judgment** (currently Fable)

An **absent rating reads as mechanical** — existing plans parse unchanged and
the default matches LLP 0021's original entry rung. A malformed rating (not an
integer 1–5) fails the parse **loudly**, like every other task-line defect —
a silently mis-rated task is a silently mis-routed one.

The rating **seeds, never certifies**: it picks the entry rung only. From
there the LLP 0021 ladder governs — the task climbs a tier only when its
current tier exhausts its per-tier attempt budget, capping at judgment; every
gate of LLP 0002 — verified ancestry, CI at the current head — applies
identically at every rating. A misrating is
therefore cheap and self-correcting: underrated costs one climbing attempt,
overrated costs a few overpaid tokens, and neither can make bad work count as
done.

This narrows, not overturns, LLP 0020's option-2 rejection: what stays banned
is difficulty-guessing as a *substitute* for verification, or an unrecorded
estimate at dispatch time. A judgment-tier rating made at plan time, in a
reviewed artifact, controlling only cost — never doneness — is inside the
verifier-gated frame.

## Consequences

- LLP 0003 §Tasks gains an `Extended-by: 0022` forward-ref (the LLP 0015
  editorial allowance); the grammar change itself lives here.
- `parseTasks` (`src/tasks.js`) accepts the optional `complexity:` field,
  validates 1–5, and threads it onto `Task`; `neutral ready --json` carries it
  through to the implement Workflow, which maps rating → `agent({ model })`
  for attempt 1.
- The reconcile skill's Impl-designer section instructs rating every task and
  documents the mapping.
- LLP 0021's ladder gains a variable entry rung: a task starts at its rated
  tier and climbs only after that tier exhausts its per-tier attempt budget M.
  A rating of 5 (judgment entry) therefore has no ladder above it — it runs its
  judgment budget and then sticks. LLP 0021's consequence that `neutral:stuck`
  certifies a judgment-tier failure still holds for every entry rung.
- Ratings are per-task and immutable with the plan (LLP 0015): re-rating is a
  plan change, not a runtime mutation.
