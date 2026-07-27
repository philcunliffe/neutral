# LLP 0034: Watchdog — a third LLM loop heals wedged reconcile loops

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0010, 0013, 0014

## Context

A production wedge (hypaware-server loop, 2026-07-27): a reconcile tick's turn
died at 03:20 UTC on an API timeout mid-fix. The heartbeat contract (LLP 0013)
re-arms the next wakeup at **end of tick**, so a turn that dies mid-tick never
schedules one — the session sat live but silent for ~13 hours until a human
noticed. The container supervisor (`docker/entrypoint.sh`) could not see it:
it detects **dead** sessions (`tmux has-session`) and a dead hyp-daemon, but a
*live-but-silent* claude session is indistinguishable from a healthy one at
that layer. Nothing watches for wedges.

## Decision

<a id="third-loop"></a>**A third loop, `neutral-watchdog`, runs in the same
container** — `claude --model claude-opus-5[1m] '/loop 55m /neutral-watchdog'`
in its own tmux session — and once an hour health-checks every reconcile-loop
session and heals what is wedged. (55 minutes, not 1 h: `/loop` offers an
interactive cloud-schedule menu for intervals ≥60 min, which wedges a headless
session at the menu — discovered on first deploy.) It is an **LLM loop, not a shell check**,
because recovery is judgment: reading what died mid-flight, recognizing that
input-line text is a harness prefill (a rendered suggestion, not human
input) and never submitting it, wording a resume nudge, and deciding when
150k+ tokens of accumulated context are worth preserving versus discarding.

<a id="wedge-predicate"></a>**The wedge predicate is ground truth (LLP 0002),
never pane heuristics or self-report:** a loop is wedged when the newest
**event timestamp inside** its session transcript
(`~/.claude/projects/-work-<name>/*.jsonl`) is older than 45 minutes (loops
promise ≤30-minute heartbeats) *and* its pane shows no active work. File
mtime is explicitly not the signal — in the incident the transcript mtime read
16:07 while the last event inside it was 03:20.

<a id="recovery-ladder"></a>**Recovery prefers the gentlest act that works:**
nudge the live session with a resume message (preserves context and
mid-flight work) → kill and respawn fresh (always safe — state is
derived from git, LLP 0002). A session missing entirely is respawned.

<a id="mutual-coverage"></a>**The supervisor heals the watchdog; the watchdog
heals the loops.** The deterministic supervisor gains one deterministic duty —
respawn a dead watchdog session (same shape as its hyp-daemon duty) — and the
watchdog owns everything requiring judgment. Neither watches itself, so there
is no self-reference hole: a dead watchdog is caught by the supervisor within
30 s; a wedged loop is caught by the watchdog within the hour.

## Rejected

<a id="shell-check-rejected"></a>**A staleness check inside the supervisor
loop, rejected.** A script can detect a stale transcript but can only kill
blindly. Every soft wedge (a recoverable API error, an interactive dialog) would cost
the session's full context, and a script pressing Enter on input-line text
it cannot read is exactly the class of blind act that would submit a harness
prefill — the input line renders suggestions like `stop the loop` — to a
healthy loop.

<a id="host-cron-rejected"></a>**A cron/agent on the host, rejected.** It
breaks the container as the self-contained deploy unit — recovery would
depend on host config that a `docker run` on a new box would silently lack.

## Consequences

- While the watchdog is enabled (`NEUTRAL_WATCHDOG=1`, the default) the
  container no longer exits when all repo loops die — the watchdog resurrects
  them. Teardown is `docker stop`. `NEUTRAL_WATCHDOG=0` restores the old
  exit-when-loops-die behavior.
- The LLP 0013 heartbeat contract gains an enforcement arm: a promised-but-
  never-fired tick is now detected within the hour instead of never.
- The watchdog is container-only for now; `neutral start` (single-repo dev
  loops on a workstation, LLP 0014) does not spawn one.
