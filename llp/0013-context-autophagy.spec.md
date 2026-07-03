# LLP 0013: Context autophagy — recycle the orchestrator's context on idle ticks

**Type:** Spec
**Status:** Draft
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-25
**Related:** 0000, 0002, 0008, 0010, 0011, 0014, 0016

## Purpose

The one orchestrator is a long-lived `/loop` session (LLP 0010), so its context grows
tick over tick — even on **idle** ticks, which append re-derivable observe-output to a
transcript that LLP 0002 makes worthless to retain. Context autophagy recycles that
context **only on idle ticks, using slack capacity**: when the loop has nothing better
to do and its context has grown past a threshold, it tears itself down and re-enters
fresh.

This spec covers **context autophagy only** — the runtime (self-directed) flavour of
the autophagy family proposed in LLP 0011. It produces **no git artifact**. The
repo-hygiene members (dead-code trim, LLP repair, branch prune, dependency hygiene)
are deferred to their own specs; nothing here builds them.

The **mechanism** — tmux self-respawn, and why it preserves the one-orchestrator
invariant — is an execution-model fact and lives in
[LLP 0010 §Context recycle](0010-execution-model.decision.md#context-recycle). This
spec owns the **policy**: *when* to recycle, and how the two conditions are read as
ground truth.

## Trigger

At **end-of-tick**, after fan-in and after emitting the tick's log lines, the
orchestrator recycles iff:

```
idle  ∧  context-size > T
```

Both conditions are **ground truth**, never the orchestrator's own judgement
(LLP 0002). If either is false, the tick ends normally — it schedules the next tick
(`ScheduleWakeup`) and does **not** respawn.

### `idle` — neutral reached and nothing in flight

A tick is **idle** when the repository is at **neutral state** (LLP 0008) *and* no
work is in flight — across **both** reconciler families:

- `neutral backlog --json` is empty (no uncovered request LLP), **and**
- every in-scope PR's `action` is `held` (terminal) — `neutral prs --json`, **and**
- no issue is in `needs-fix` — `neutral issues --json`.

**`wait` is not idle.** A PR with `action: wait` — mergeability `UNKNOWN`, or checks
`PENDING` (`src/prhealth.js`) — is *in flight*, not at rest (LLP 0002: "not yet
observable ≠ false → re-observe next tick"). Recycling while a check runs would
contradict the safety precondition below, so idle admits only `held`. A permanently
`PENDING` check keeps the repo out of idle and out of autophagy — correct, because a
hung check *is* unfinished work.

This predicate must be **deterministic and offline-testable** (CLAUDE.md): it is a
pure function of the three observe outputs, not LLM prose. It SHOULD be exposed by the
core as a single signal (e.g. `neutral idle --json → { idle, blockers }`) so the
orchestrator *acts on* it rather than re-deciding it.

### `context-size > T` — measured, never estimated

A running session **cannot introspect its own token count**; any number the model
states is a fabrication, i.e. the self-report LLP 0002 forbids. The size is therefore
read from an **independent observer** — the harness's own per-turn `usage` accounting,
written to the session transcript:

- Locate the session's **own** transcript by `$CLAUDE_CODE_SESSION_ID` (so a
  sub-agent's transcript cannot be mistaken for it).
- Take the **last** record carrying `usage` and sum
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.

This is the API's own count (cf. GitHub mergeability, a CI verdict), so re-reading it
satisfies LLP 0002. It requires **no recording proxy**. The read is a pure function of
the transcript file and MUST be **offline-testable** (CLAUDE.md) against a fixture
transcript.

**T** is a single tuning constant, set *below* the harness auto-compact threshold so
the recycle fires before lossy summarization. It is generous on a 1M-window model.
Picking the value is empirical tuning, not a design unknown.

## Mechanism (reference)

The recycle is the tmux self-respawn defined in
[LLP 0010 §Context recycle](0010-execution-model.decision.md#context-recycle):

```sh
tmux respawn-pane -k "claude '/loop /neutral-reconcile'"
```

Extended-by: 0020 — the respawn command must pin the orchestrator's model
(`claude --model opus …`); an unpinned respawn silently reverts the fresh
orchestrator to the machine's session default. See LLP 0020 §Decision and the
reconcile skill's autophagy section for the live command.

Performed in place of scheduling the next tick. No `-t`: tmux defaults to the current
pane (`$TMUX_PANE`), so the respawn is independent of the per-repo session name
(`neutral-<repo-folder>`, LLP 0014). `respawn-pane -k` atomically kills the current
session and starts a fresh one in the same pane; the **pane is the one-orchestrator
mutex**, so no lock is needed. The fresh session re-`observe`s every gap from git/the
API — **no handoff state** crosses the boundary (LLP 0002).

## Requirements

- **R1 — Slack-only.** Recycle fires only on an idle tick. A real gap in either family
  always pre-empts it: autophagy never runs while reconciler work is pending, and
  never competes for the tick budget (LLP 0011).
- **R2 — End-of-tick, after fan-in.** The recycle is the tick's **last** act, after
  serial verified merges and after the tick's log lines are emitted. It is destructive
  (it kills the session), so nothing may follow it.
- **R3 — Ground-truth conditions.** Both `idle` and `context-size` are re-derived from
  observation (the observe outputs; the transcript), never self-reported (LLP 0002).
- **R4 — One-orchestrator preserved.** The recycle uses tmux `respawn-pane -k`; the
  pane is the mutex. No code path may spawn a successor that can overlap the
  predecessor (LLP 0010).
- **R5 — Self-rate-limiting.** Because the trigger keys on measured context size and a
  respawn resets the transcript to baseline, autophagy cannot fire again until context
  regrows past T (tens of idle ticks). No separate "one initiative per idle period"
  cap is required for this flavour.
- **R6 — tmux precondition, graceful fallback.** Recycle requires the loop to be
  running inside a tmux pane (detect via `$TMUX`). When not in tmux, context autophagy
  is unavailable and the tick degrades to harness auto-summarization for context
  growth — it MUST NOT attempt a `setsid`/detached self-relaunch (the two-orchestrator
  hazard, LLP 0010 §Context recycle, rejected alternatives).

## Realization

Context autophagy is realized as the final step of the reconcile tick — the
`neutral-reconcile` skill's step 6 ("Return. The loop schedules the next tick.")
becomes a branch: *if `idle ∧ context-size > T`, respawn (LLP 0010 §Context recycle)
instead of scheduling.* The change lands in the skill (the orchestrator), not the
deterministic core; the core gains only the **idle predicate** and the
**context-size read**, both pure and unit-tested. Code realizing this spec annotates
`// @ref LLP 0013#... [implements]` and the mechanism `// @ref LLP 0010#context-recycle
[constrained-by]`.

## Out of scope

- **Repo-hygiene members** (dead-code trim, LLP repair, branch prune, dependency
  hygiene) — deferred to their own specs (LLP 0011 roadmap). Their *held-never-merged*
  and *propose-never-assert* rules, and the "one initiative per idle period" cap, are
  theirs, not this spec's.
- **Basal (always-on) sweeping** — context autophagy is idle-induced only (LLP 0011).
- **A precise proxy-measured threshold** — reading size from a recording proxy
  (Collectivus/HypAware) is a possible productionization upgrade; v1 uses the
  transcript, which needs no proxy.

## References

- [LLP 0002](0002-ground-truth.principle.md) — ground truth, never self-report (idle,
  context size, and "no handoff" all derive from it)
- [LLP 0008](0008-neutral-state-and-reconciler-families.decision.md) — neutral state
  (what `idle` coincides with)
- [LLP 0010 §Context recycle](0010-execution-model.decision.md#context-recycle) — the
  tmux self-respawn mechanism and the one-orchestrator mutex
- [LLP 0011](0011-autophagy.rfc.md) — the autophagy family, scavenger principle, and
  slack-only trigger this is the v1 member of
