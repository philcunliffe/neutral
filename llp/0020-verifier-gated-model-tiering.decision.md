# LLP 0020: Verifier-gated model tiering — the verifier picks the model, not the task

**Type:** Decision
**Status:** Accepted
**Systems:** Engine, Designer, Engineer, Reviewer
**Author:** Phil / Claude
**Date:** 2026-07-03
**Related:** 0002, 0003, 0009, 0010, 0013, 0017, 0021, 0022

## Context

Every dispatch point in the tick — the orchestrator itself, the pipeline workers
(Designer, Impl-designer, the implement Workflow's agents), and the maintenance
rungs (LLP 0009) — currently inherits the session default: the strongest
available model. The dispatch points differ enormously in cognitive demand:
`derive-ready` relays a CLI's JSON verbatim, while the Designer partitions a
whole backlog into a change-set DAG. Paying the top tier for the former is pure
waste, and it is the *frequent* points (the per-tick orchestrator, the per-wave
queue read) that dominate spend, not the rare hard ones.

The architecture already contains the fact that makes cheaper models safe:
**"done" is never self-reported** (LLP 0002). A task is merged only when git
proves ancestry; green only counts from CI at the current head; a fix exists
only when a regression test flipped. Where such a verifier gates the output, a
weaker model's failure mode is *the gap stays open and is re-dispatched next
tick* (LLP 0010 §Partial failure) — never silently-accepted bad work.

## Options considered

1. **Uniform default model everywhere.** Simple, and what happens today by
   inheritance. Spends the scarcest tier on mechanical relay work; the
   orchestrator alone re-reads up to the autophagy threshold (LLP 0013) of
   context on it every tick.
2. **Route by guessed task difficulty.** Estimate per-task complexity up front
   and pick a model. No reliable signal exists before an attempt is made — the
   guess is itself an unverified self-report, the thing LLP 0002 exists to ban.
   (Rejected as a *substitute* for verifier-gating. LLP 0022 later adopts a
   bounded form — the judgment-tier planner's recorded rating — purely as a
   seed for the entry rung, inside this frame.)
3. **Tier by verifier coverage (chosen).** Ask one question per dispatch point:
   *does a deterministic verifier gate this output?* The answer is a property of
   the architecture — readable off LLP 0002/0009 — not a guess about the work.

## Decision

A dispatch point's model tier is set by **what checks its output**, not by how
hard its input looks:

- **Judgment tier (strongest model — Fable).** Stages whose output quality no
  machine re-derives, where an error propagates instead of bouncing: the
  **Designer** (backlog partition + technical design), the **Impl-designer**
  (the task DAG whose quality is exactly what lets cheaper implementers
  succeed), and the **triage rung** (LLP 0017) — an all-or-nothing ship/no-ship
  call where misreading a blocker as a preference merges a production defect.
  Triage is rare and small-input, so keeping it smart costs almost nothing.
- **Worker tier (mid model — currently Opus 4.8).** Bounded work behind a hard
  gate: **conflict resolution** (green-local-before-push, CI is the authority,
  backs off to `neutral:stuck`), **issue-fix** (no failing-then-passing
  regression test ⇒ no PR), the Claude half of the **review** rung (Codex
  supplies the independent second family). And the **orchestrator itself**: the
  tick is deliberately mechanical — the CLI decides every rung ("you act, you
  do not re-decide"), fan-in is git commands — and it is the single largest
  spend, so it does not need the judgment tier.
- **Mechanical tier (small model — currently Sonnet 5; Haiku where the agent
  only relays a CLI).** Fully verifier-gated execution: **task implementation**
  (small, independently mergeable, fully specified by the plan LLP; the
  verified merge catches failure), the **serial merger** (procedural git with
  explicit three-way verification), **fix-ci** (usually mechanical; the rung
  re-observes every tick), review-**fix** agents (fixes are positively verified
  against the tree), and **derive-ready** (returns `neutral ready --json`
  verbatim, schema-enforced).

The **binding of tier → model name lives in the code** — the reconcile skill's
dispatch instructions and the implement Workflow's `agent()` options, each
`@ref`ing this decision — so a model-generation bump is a normal reviewed code
change. What this document fixes is the *principle*: only a change to
"verifier coverage picks the tier" needs a superseding decision (LLP 0015).

One operational corollary: the orchestrator's model is chosen at launch, so the
context-autophagy respawn command (LLP 0013) must **pin the same model** — an
unpinned respawn silently reverts the orchestrator to the session default.

## Consequences

- The reconcile skill names a tier per fan-out worker; the implement Workflow
  passes `model`/`effort` per `agent()` call; both `@ref` this decision.
- `neutral start` and the autophagy respawn line carry an explicit `--model`.
- Failure-triggered *escalation* up the ladder — retrying a verified-failed
  attempt on a bigger model instead of the same one — is its own choice,
  LLP 0021.
- No config surface: the tiering is hardcoded in the skill/Workflow, not
  `.neutral/config.json`. A per-repo `models` knob is deferred until a second
  repo actually needs different tiers (same restraint as LLP 0007's minimal
  config).
- The judgment/worker/mechanical vocabulary is the stable citation target;
  model names in this document are the binding *as of its date* and are
  expected to drift with generations without superseding this decision.
