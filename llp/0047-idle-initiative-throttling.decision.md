# LLP 0047: Idle-initiative throttling — cooldown-gated, least-recently-run rotation with idle as a first-class outcome

**Type:** Decision
**Systems:** Core, Engine
**Status:** Active
**Author:** Phil / Claude
**Date:** 2026-07-28
**Related:** 0002, 0008, 0011, 0013, 0035, 0036

## Context

LLP 0035 settled idle-initiative selection for a two-member world: the context
recycle preempts repo hygiene, and otherwise the one repo-hygiene member
(cleanup, LLP 0036) runs **whenever it is eligible**. Eligibility was the only
brake, and it releases the instant a human disposes of the last cleanup PR
(LLP 0036 §eligibility / R2). Two gaps follow, and both are now biting as the
repo-hygiene roster starts to grow beyond one member:

1. **A member runs on every idle tick it can.** Once the previous PR is gone, the
   next idle tick re-selects the same member — there is no "I have cleaned a lot
   lately, rest" and no way for an idle tick to *deliberately* do nothing while a
   member is eligible. Genuine idleness is not an available outcome.
2. **A no-op scan re-runs forever.** A cleanup scan that finds nothing opens **no
   PR** (LLP 0036 §Delivery, `action=cleanup-noop`), so it leaves no artifact to
   rate-limit against. The member re-scans the same static tree every idle tick
   until real work lands — the loudest form of gap (1).

The requirement (Phil): autophagy must **not** have to act on every idle tick,
must **back off after doing a lot recently**, must let an idle tick simply be
idle, and must **scale to multiple future members** without one starving the
others. This decision generalizes LLP 0035's fixed order into a throttled,
rotating selection. It keeps LLP 0035's load-bearing choices intact — one
initiative per tick, runtime preempts repo hygiene, the CLI selects and the
orchestrator acts — and replaces only *which repo-hygiene member runs, and
whether one runs at all*.

## Decision

<a id="idle-is-first-class"></a>**`null` is a legitimate initiative.** An idle
tick may deliberately run **nothing** even while a member is nominally eligible.
`neutral idle --json`'s `initiative` field returns `null` not only when no member
is configured/eligible but also when every eligible member is inside its cooldown
or dampened (below). Doing nothing on slack capacity is the correct outcome, not
a missed opportunity.

<a id="cooldown"></a>**Per-member cooldown, anchored on the last disposition,
metered in wall-clock, configurable.** After a member's PR reaches a terminal
disposition, that member is ineligible until a cooldown elapses. The anchor is
the **last `autophagy/<member>` PR's disposition timestamp** — `mergedAt` for an
accepted PR, `closedAt` for a rejected (closed-unmerged) one — read from GitHub,
the API's own accounting (cf. mergeability, a CI verdict), so it is ground truth,
never a self-reported ledger (LLP 0002). "Now − disposition" against a
configurable duration is the gate. Two durations, because the two dispositions
mean opposite things:

- `autophagy.cooldownAfterMergeHours` — backoff after an **accepted** cleanup
  ("keep going, but not every tick").
- `autophagy.cooldownAfterRejectHours` — backoff after a **rejected** one
  ("stop proposing this"); defaults **longer** than the merge cooldown.

Both are per-repo tunables in `.neutral/config.json`. `0` disables that arm;
equal values make the cooldown disposition-blind. Anchoring on the *disposition*
rather than the *merge* is deliberate: a merge-only anchor is blind to a
rejection (no merge commit exists), and would re-offer a just-rejected proposal
on the next idle tick — the exact nag the reject cooldown exists to prevent.
These durations are per-member policy shared across members for now; a
per-member override is a later extension, not built until a member needs it.

<a id="noop-dampening"></a>**A no-op is damped by target HEAD, as a
session-scoped scheduling hint.** A no-op leaves no git artifact, so it cannot be
made a durable ground-truth fact — and must not be forged into one by churning
the target with marker commits or tags. Instead: a member that no-op'd at target
HEAD `X` stays dormant until HEAD **advances past `X`**. Since an idle repo's
target HEAD is static, this means a member scans **once** per idle period, finds
nothing, and goes quiet until the codebase actually changes or the context
recycles. The "last no-op HEAD" is a **within-session scheduling hint**, not a
fact claim — exactly the latitude LLP 0036 §Delivery already grants ("the
orchestrator MAY dampen repeat no-op scans within its own session… a scheduling
hint, not a fact claim — LLP 0002 governs facts"). It resets on a context
recycle (LLP 0013), which is correct: a fresh orchestrator re-scans once, finds
nothing, and re-damps. This is the one sliver of orchestrator state the selection
carries; every other input is re-derived from git/GitHub.

<a id="rotation"></a>**Least-recently-run rotation across eligible members.**
Among repo-hygiene members that are configured on, past their cooldown, and not
no-op-damped, the selected member is the one whose **last `autophagy/<member>`
disposition is oldest**. A member that has **never run** sorts as oldest, so a
newly-added member takes its first turn ahead of veterans. Ties break by a fixed
member order. Rotation (not a fixed priority list) is built in from the start:
with a fixed list, a frequently-eligible high-priority member starves the rest;
LRR spreads slack capacity across the roster and lets an all-in-cooldown roster
fall through to `null` naturally.

<a id="gate-global"></a>**One open autophagy PR at a time, across all members.**
LLP 0036 R2's "one `autophagy/*` PR open" gate is **global**, not per-member: at
most one autophagy PR of *any* member is open at once (LLP 0011's anti-churn —
don't flood the human's review queue). The rotation therefore only selects when
no `autophagy/*` PR is open at all; an open one takes the whole family out of
contention until the human disposes of it. This also self-serializes the family
through the idle gate (LLP 0035 §one-initiative), unchanged.

<a id="recycle-preempts"></a>**Runtime still preempts repo hygiene.** The context
recycle (LLP 0013, `idle ∧ context > T`) preempts every repo-hygiene member
exactly as LLP 0035 §priority decided, and does not participate in the cooldown
or rotation — it self-rate-limits by context reset (LLP 0013 R5). This decision
changes only the selection *among repo-hygiene members* and whether one runs.

<a id="selection"></a>**The selection order** the CLI computes (LLP 0035
§cli-selects, unchanged mechanism):

1. `recycle` if the context recycle is due → done.
2. else if any `autophagy/*` PR is open → `null` (global gate).
3. else among members {config-on ∧ past cooldown ∧ not no-op-damped}, the
   least-recently-run by last disposition; ties by fixed order.
4. else `null`.

## Rejected

<a id="fixed-priority-rejected"></a>**Fixed priority list among repo members.**
LLP 0035's `recycle > cleanup` extended naively to `recycle > repair > cleanup >
…`. Simple, but a chatty high-priority member with a short cooldown starves lower
ones. LRR costs one extra ground-truth read per member and gives fairness for
free; taken.

<a id="stateless-rejected"></a>**Strictly stateless selection.** Refusing even a
session scheduling hint keeps LLP 0035's "CLI computes it all from ground truth"
purity, but it does **not** fix the no-op loop — it *is* the no-op loop. The
hint is non-durable, non-fact, and already sanctioned by LLP 0036; the purity
cost is worth closing the loop.

<a id="commits-since-rejected"></a>**Commits-since-last-merge as the sole
anchor.** Ground-truth and ledger-free, but it anchors only on merges — a
rejected (closed-unmerged) PR leaves no commit, so a rejection is invisible and
the member re-offers immediately. Disposition-timestamp anchoring subsumes it and
handles both verdicts.

<a id="global-budget-rejected"></a>**A global autophagy time-budget** ("at most
one autophagy PR per day, any member"). Redundant: the global one-open-PR gate
plus per-member cooldowns plus human disposal already pace the family. Add only
if the roster grows large enough that per-member cooldowns still overwhelm review.

## Config

`autophagy` gains two wall-clock cooldowns (hours, integers; empirical to tune):

```jsonc
"autophagy": {
  "codeCleanup": true,          // LLP 0036 — the per-member off-switch
  "cooldownAfterMergeHours": 24,   // backoff after an accepted cleanup PR
  "cooldownAfterRejectHours": 168  // longer backoff after a rejected one
}
```

No-op dampening is **not** configurable — it is a correctness fix for the
re-scan loop, not a policy knob.

## Realization

- `src/autophagy.js` — the pure classifier widens: `cleanupState` (and each
  future member's) takes the closed-`autophagy/*` PR observation (head +
  `mergedAt`/`closedAt`) and current time, and reports `{ eligible,
  cooldownRemaining, reason }`. A new pure selector ranks eligible members by
  last disposition (LRR) and applies the no-op-damp set passed in by the
  orchestrator. All offline-testable against fixtures (CLAUDE.md).
- `src/commands/idle.js` — `neutral idle --json` reports per-member
  `{ eligible, cooldownRemaining }` and folds the rotation into the single
  `initiative` field; the enum generalizes `recycle | <member> | null`.
- `src/github.js` / `src/commands/prs.js` — supply the closed-`autophagy/*` PR
  dispositions (the maintenance family already lists PRs; this adds closed-state
  timestamps to the observation).
- `src/config.js` — the two cooldown fields, merged and validated like
  `contextRecycleThreshold`.
- The `neutral-reconcile` skill — the orchestrator holds the no-op-HEAD
  scheduling hint for its session and passes it to `neutral idle`; the
  end-of-tick branch acts on the selected `initiative`.

Code realizing this decision annotates `// @ref LLP 0047#<anchor> [implements]`.

## References

- [LLP 0035](0035-idle-initiative-selection.decision.md) — the fixed
  recycle-preempts / one-per-tick / CLI-selects frame this extends; only the
  *which repo member, and whether one runs* is changed
- [LLP 0036](0036-code-cleanup-autophagy.spec.md) — the cleanup member this
  throttles; its deferred no-op-cooldown open question is resolved here
- [LLP 0011](0011-autophagy.rfc.md) — the family, the anti-churn bound, and the
  induced-only (idle) stance this keeps
- [LLP 0013](0013-context-autophagy.spec.md) — the recycle member that preempts
  and self-rate-limits, exempt from this throttling
- [LLP 0002](0002-ground-truth.principle.md) — why the cooldown anchors on
  GitHub's disposition timestamps and the no-op damp is a hint, not a fact
