# LLP 0011: Autophagy — idle-tick scavenging on slack capacity

**Type:** RFC
**Status:** Draft
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-25
**Related:** 0000, 0001, 0002, 0008, 0010, 0013

## Context

When a tick observes **no actionable gap** in either reconciler family (LLP 0008)
— empty backlog, every PR action ∈ `{wait, held}`, no `needs-fix` issue — the repo
has reached **neutral** and the orchestrator does nothing but burn the tick. Two
things accrue in that idle state that no reconciler will ever touch:

1. **The `/loop` context grows even when nothing happens.** Each idle tick still
   adds observe-output and a log line to the orchestrator's conversation, and the
   harness eventually pays to (lossily) summarize a transcript that, by LLP 0002, is
   re-derivable from git and therefore worthless to retain.
2. **Low-grade cruft no invariant owns.** Dead code, malformed or stale LLPs, broken
   `@ref` annotations, merged-but-undeleted branches, abandoned worktrees, a stray
   runtime dependency in the deterministic core. None of these are *gaps* in the
   LLP 0001 sense — there is no base state they violate — so the reconcilers, which
   close violations of an invariant, will never address them. Yet idle capacity is
   free.

The reconcilers are the wrong tool for both. A reconciler holds an **invariant** and
converges the world to a **base state**; "no dead code" and "context under N tokens"
are not base states — there is no violation to detect, only an opportunity to take.
Modelling them as invariants would make the loop aggressively "fix" things that were
never wrong (deleting code that looks unreferenced but is reached by reflection or is
public API, churning LLPs, etc.) — a direct collision with the no-fabrication
principle (LLP 0002).

## Proposal

Introduce **Autophagy**: a family of housekeeping skills the orchestrator runs **only
on idle ticks**, consuming slack capacity. The name is literal — like a cell starved
of external nutrients, the reconciler turns inward on idleness and recycles its own
damaged or surplus components for reuse.

**Autophagy is a scavenger, not a reconciler.** This is the load-bearing distinction.
It holds no invariant and has no base state to converge to; it *opportunistically
improves*, it never *restores a violation*. Three rules fall out and they are what
keep it safe:

- **Slack-only.** Autophagy fires *only* on an idle tick (neutral reached, LLP 0008)
  and runs within the remaining tick budget. The instant a real gap appears in either
  family, autophagy **yields** — reconciler work always wins. It never competes.
- **Held, never merged.** Repo-facing autophagy output is a held PR / doc edit carried
  by `reconcilePR` to *mergeable ∧ green ∧ reviewed* like anything else. The
  never-merge invariant (LLP 0002, LLP 0008) is unchanged.
- **Propose, never assert.** Autophagy's "is this dead?" / "is this LLP malformed?"
  must be a re-derivable fact (LLP 0002). When confidence is anything short of
  mechanical, it **proposes** (a held PR a human decides on) and never asserts a trim
  as correct.

> **Scope of this RFC — context autophagy first.** This RFC *commits to building only
> the runtime flavour — **context autophagy** (the v1 member). The repo-hygiene
> members (dead-code trim, LLP repair, branch prune, dependency hygiene, …) and the
> full scavenger family are **deferred**; they are kept below as the roadmap this
> generalizes to, not as work this commit takes on.
>
> For context autophagy alone, only the **slack-only** rule is load-bearing — it
> produces no git artifact, so *held-never-merged* and *propose-never-assert* don't
> bind it (both govern the deferred repo-hygiene members). Its only judgments are "am
> I idle?" and "am I over T?", and both are ground-truth (Trigger; §v1 member). The
> "scavenger, not a reconciler" distinction is real but **only exercised when the
> repo-hygiene members land** — its precise framing (some members have crisp base
> states yet are still scavengers because they *block nothing*) is parked with them.
>
> One consequence simplifies too: with the trigger keyed on **measured context size >
> T**, context autophagy **self-rate-limits** — a respawn resets the transcript to
> baseline, so it cannot fire again until context regrows past T (tens of idle ticks).
> No separate "one initiative per idle period" cap is needed for the runtime flavour;
> that cap returns with the repo-hygiene members (don't open 40 dead-code PRs).

### Trigger

An **idle tick** is one that has reached **neutral state** (LLP 0008) *and* has
nothing in flight — `observe` (the tick's CLI eyes, LLP 0010 step 1–2) returns no
actionable gap **and no pending work** across *both* families:

- `neutral backlog --json` empty,
- every in-scope PR's `action` is `held` (terminal) — `neutral prs --json`,
- no issue in `needs-fix` (`neutral issues --json`).

**`wait` is not idle.** A PR with `action: wait` (mergeability `UNKNOWN`, or checks
`PENDING` — `src/prhealth.js`) is *in flight*, not at rest: LLP 0002's "not yet
observable ≠ false → re-observe next tick". Folding `wait` into idle would let
context autophagy tear the loop down *while CI is running* — contradicting v1's own
safety precondition ("nothing is in flight, that is what idle means"). So idle
admits only `held`. The cost is deliberate: a permanently-`PENDING` check (a hung
job) keeps the repo out of idle and out of autophagy — correct, because a hung check
*is* unfinished work; context growth then falls back to harness summarization.

Idle so defined coincides with LLP 0008 neutral state: every gap neutral can close
*autonomously* is closed and **held**. Only then does the orchestrator run one
autophagy initiative before returning. A tick that *was* idle but is no longer (a
push or a human merge landed) re-observes next tick and skips autophagy — slack
evaporated.

### Two flavours, differing in kind

- **Runtime hygiene (self-directed)** — acts on the orchestrator's *own* execution
  state, produces **no git artifact**. The v1 member, **context autophagy**, lives
  here.
- **Repo hygiene (world-directed)** — produces **held PRs / doc edits**, re-verified
  from ground truth, carried by `reconcilePR`. All deferred members live here.

### v1 member — context autophagy

*Specified for implementation in [LLP 0013](0013-context-autophagy.spec.md); the
mechanism lives in [LLP 0010 §Context recycle](0010-execution-model.decision.md#context-recycle).*

On an idle tick, if context size exceeds a threshold **T**, recycle it. This is safe
*precisely because the tick is idle* (as narrowed above: neutral reached **and**
nothing in flight): no worker is mid-flight to strand, and all state is in git
(LLP 0002), so a fresh-context re-entry **re-`observe`s everything and loses
nothing**. There is nothing to *hand off* — anything not in git would be a
self-report (LLP 0002), so the recycle carries no state; it simply re-derives.

**Mechanism — tmux self-respawn (resolves Open Q1).** There is *no* model-invokable
"clear my own context" primitive inside a running `/loop`, and `ScheduleWakeup`
re-enters the **same** growing context. Genuinely fresh context therefore requires
tearing the session down and starting a new one — and the loop can do that to
*itself*, safely, by running inside a **tmux pane**:

```sh
# runtime precondition — launch the orchestrator inside tmux, not bare `claude`
# (wrapped by the `neutral start` launcher):
tmux new-session -s neutral 'claude "/loop /neutral-reconcile"'

# the recycle, run on an idle tick when context > T:
tmux respawn-pane -k -t neutral "claude '/loop /neutral-reconcile'"
```

`respawn-pane -k` is one atomic tmux-server operation: **kill** the current `claude`
in the pane, then **start a fresh one** in the same pane, which boots with empty
context and re-enters `/loop /neutral-reconcile` itself. The **pane is the mutex** —
tmux guarantees the old session is dead before the new one starts, so the
one-orchestrator invariant (LLP 0010) holds *by construction*: no flock, no liveness
lock, no `sleep`-timing guess, and tmux supplies the pty so the successor is a real
interactive `/loop`, not a headless `-p`. The session stays `/loop`, stays
LLM-self-healing; it just periodically gets a clean head.

**Trigger metric — measured tokens, never an estimate (LLP 0002).** "Context > T"
is evaluated from an *independent observer*, not the model's guess at its own size
(which would be the exact self-report LLP 0002 forbids). The harness writes each
turn's real `usage` to the session transcript; the orchestrator reads its **own**
transcript — keyed by `$CLAUDE_CODE_SESSION_ID` (so a sub-agent's transcript can't be
mistaken for it) — and sums the last record's `input_tokens +
cache_creation_input_tokens + cache_read_input_tokens`. That is the API's own
accounting (cf. GitHub mergeability, a CI verdict), so re-reading it satisfies the
principle. No recording proxy is required, and a respawned session starts from a
fresh transcript, so the count self-resets. **T** is a tuning constant set *below*
the harness auto-compact threshold, so the recycle fires before lossy
summarization — generous on a 1M-window model.

This is the **cheap twin of the per-tick delegation** considered for the same problem
(LLP 0010 §context lifecycle / the execution-model discussion): rather than
restructuring *every* tick to keep context small, let it grow and recycle it **only
when idle**, when there is nothing better to do. The two compose — delegation slows
growth, context autophagy recovers the residue — and either alone is sufficient.

## Options considered

- **Do nothing; rely on harness auto-summarization.** The loop won't crash, but
  summarization is lossy (could silently drop a surfaced gap) and re-summarizes a
  growing, re-derivable transcript every few ticks — wasted spend and a small
  correctness risk for zero benefit on a stateless reconciler. Rejected as the
  *default*, kept as the fallback if no context-clear primitive exists.
- **Model cleanup as new reconcilers / invariants.** Rejected: no base state exists
  to converge to; turns opportunity into mandate and invites fabricated "violations"
  (LLP 0002).
- **A separate cleanup loop / cron.** Rejected: revives the multiple-sessions race the
  one-orchestrator-per-repo invariant exists to prevent (LLP 0010). Autophagy runs
  *inside* the single orchestrator, on its idle ticks.

## Members (roadmap — only v1 committed)

This decision commits to the **family, the trigger, the scavenger principle, and
context autophagy (v1)**. Each repo-hygiene member below is deferred to its own spec:

| Member | Flavour | Ground-truth signal |
| --- | --- | --- |
| **context** (v1) | runtime | observed context size > T |
| dead-code trim | repo | construct with no import / test / `@ref` reachability |
| LLP repair | repo | broken `Related:` / `@ref` (cf. `ref-check`), missing metadata, un-tombstoned superseded docs |
| coverage backfill | repo | code realizing a documented decision with no `@ref` (LLP 0003) |
| branch prune | repo | merged `integration/*` / `fix/*` not yet deleted (LLP 0010 §Handoff) |
| worktree prune | runtime | abandoned worktrees from failed workers |
| dependency hygiene | repo | a runtime dependency in the deterministic core (CLAUDE.md) |

## Consequences

- **One orchestrator holds.** Context autophagy's tmux self-respawn
  (`respawn-pane -k`) kills the old session before starting the fresh one in the same
  pane — the pane is the mutex, so there are never two orchestrators at once
  (LLP 0010 unchanged). Precondition: the loop runs inside a tmux pane.
- **Never competes.** Autophagy consumes only idle capacity; any real gap pre-empts it
  next tick. Throughput of the reconcilers is untouched.
- **Bounded / anti-churn.** At most **one autophagy initiative per idle period**; it
  backs off if its own held PRs are piling up unreviewed (don't open 40 dead-code PRs
  the human must triage). Repo hygiene obeys the branch-disjointness lock (LLP 0010).
- **Ground truth, still.** Autophagy proposes; the human disposes (held PRs), and
  "done" is re-derived from git like everything else (LLP 0002). It widens *what* the
  loop notices on idle, not *how* truth is established.

## Open questions

- ~~**The context-clear primitive.**~~ **Resolved.** No model-invokable clear exists
  inside a running `/loop`, and `ScheduleWakeup` re-enters the same context. The
  mechanism is **tmux self-respawn** (`respawn-pane -k`): the loop, running inside a
  tmux pane, atomically kills itself and starts a fresh `claude "/loop
  /neutral-reconcile"` in the same pane. No handoff doc — the successor re-`observe`s
  from git (LLP 0002). The pane is the one-orchestrator mutex. See §v1 member.
- ~~**Threshold T and observability.**~~ **Resolved (observability).** The
  orchestrator reads its own context size from its transcript
  (`$CLAUDE_CODE_SESSION_ID` → last `usage` record, summed) — an independent-observer
  fact (LLP 0002), no proxy needed. **Still open (tuning):** the value of T — how far
  below the auto-compact threshold recycling pays for itself. A single constant to
  tune empirically, not a design unknown.
- **Dead-code confidence.** Is detection ever trustworthy enough to auto-*propose*
  given reflection / dynamic dispatch / public API? Lean: high-confidence cases only,
  always held.
- **Basal vs induced autophagy.** Idle-only (induced by starvation) for v1, or also a
  light always-on basal sweep on non-idle ticks? Lean: idle-only for v1.
- **Relationship to LLP 0010 delegation.** Alternatives or composed? Lean: composed.

## References

- LLP 0000 — system map and runtime
- LLP 0001 — reconciler architecture (invariant / base state — what Autophagy is *not*)
- LLP 0002 — ground truth, never self-report
- LLP 0008 — neutral state and reconciler families (the idle / neutral boundary)
- LLP 0010 — execution model: one orchestrator, parallel fan-out per tick
