# LLP 0035: Idle-tick initiatives — one per tick, runtime before repo hygiene

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0008, 0010, 0011, 0013, 0036

## Context

LLP 0011 committed the autophagy family with a single member — context autophagy
(LLP 0013) — so the end of an idle tick was a two-way branch: recycle or schedule.
The deferred repo-hygiene members are now starting to land (first: code cleanup,
LLP 0036), which turns the idle tick into a **menu** of possible initiatives. The
family RFC bounds autophagy to "one initiative per idle period" but never had to
say *which* initiative wins when more than one is due. That selection is a real
choice with a wrong answer, so it is settled here, once, for every future member.

## Decision

<a id="one-initiative"></a>**An idle tick runs at most one autophagy initiative.**
This concretizes LLP 0011's bound at tick granularity. The bound is also
self-enforcing for repo-facing members: any initiative that opens a PR puts work
in flight, so the *next* `neutral idle` reads not-idle until that PR settles to
`held` — autophagy work serializes through the same idle gate as everything else.

<a id="priority"></a>**Runtime hygiene preempts repo hygiene.** When the context
recycle is due (`idle ∧ context > T`, LLP 0013), it fires and no repo-hygiene
initiative runs that tick. Three reasons, in order of force:

1. **T sits below the harness auto-compact threshold** precisely so the recycle
   beats lossy summarization (LLP 0013). Deferring it behind a repo-hygiene
   fan-out grows context *past* compaction mid-initiative — the exact failure the
   member exists to prevent.
2. **The recycle is destructive and must be the tick's last act** (LLP 0013 R2).
   Nothing may follow it, so it cannot share a tick with other work anyway.
3. **Nothing is lost.** The respawned orchestrator re-observes, finds the repo
   still idle, and runs the deferred repo-hygiene initiative on its *next* idle
   tick — with maximal context headroom instead of none.

<a id="cli-selects"></a>**The CLI selects the initiative; the orchestrator acts.**
`neutral idle --json` returns a single `initiative` field —
`recycle | cleanup | null` — computed from ground truth (LLP 0002), exactly as the
rung `action` is for a PR (LLP 0009). The orchestrator performs the named
initiative rather than re-deciding the priority in prose. Future members extend
the enum and this priority list; they never add a second selection site.

## Rejected

<a id="repo-first-rejected"></a>**Repo hygiene before recycle.** Superficially
attractive ("do useful work first, tidy self later"), but it defers a recycle
that is *already due* behind an initiative that grows context — inviting the
lossy auto-compaction LLP 0013 exists to preempt. The recycle-first order costs
one idle tick of latency on a repo-hygiene initiative; the repo-first order risks
correctness of the orchestrator's own context.

<a id="multiple-rejected"></a>**Multiple initiatives per tick.** Contradicts
LLP 0011's anti-churn bound, and is illusory anyway: a repo-facing initiative
takes the tick out of idle the moment its PR opens, and the recycle terminates
the session. At most one can ever complete meaningfully.

## References

- [LLP 0011](0011-autophagy.rfc.md) — the autophagy family and its
  one-initiative-per-idle-period bound, made per-tick here
- [LLP 0013](0013-context-autophagy.spec.md) — the recycle member whose
  below-compaction threshold forces the priority order
- [LLP 0036](0036-code-cleanup-autophagy.spec.md) — the first repo-hygiene
  member selected under this decision
- [LLP 0002](0002-ground-truth.principle.md) — why the CLI, not the model,
  computes the selection
