# LLP 0039: A fourth loop, the mayor — converge / heal / converse

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0010, 0013, 0014, 0034, 0038

## Context

Spawned by [RFC 0038](0038-mayor-loop.rfc.md) on acceptance. The container ran
three loops: reconcile loops **converge** repos, the watchdog **heals** wedged
loops (LLP 0034). Nothing **converses** — held PRs and stuck reports wait
silently, and steering a loop requires SSH to its pane.

## Decision

<a id="division"></a>**A fourth session, `neutral-mayor`, runs in `/work`**
(like the watchdog) as `claude ... '/loop /neutral-mayor'`. The division of
labor is three verbs: reconcile loops *converge*, the watchdog *heals*, the
mayor *converses* — it is the one session whose counterpart is a human (over
Slack, LLP 0040) rather than git ground truth. The mayor never runs reconcile
work and holds no repo; it relays to the loop that owns one, preserving
one-loop-per-repo (LLP 0010/0014). Its base state, reconciler-shaped: *the
human has been told about everything that waits on them, and every instruction
they gave has been delivered.*

<a id="tick-contract"></a>**Standard heartbeat, no special case.** The mayor
promises the ≤30-minute tick of LLP 0013; the tick is the notification scan,
so the promise bounds push latency at ~30 minutes, and the watchdog's
45-minute wedge predicate applies to the mayor unchanged. Inbound chat is not
tick-bound: a bridge injection into an idle pane starts a turn immediately
(into a busy pane it queues until the turn ends).

<a id="mutual-coverage"></a>**Mutual coverage extends, still without
self-reference** (LLP 0034 §mutual-coverage): the deterministic supervisor
respawns a dead mayor and a dead bridge; the watchdog heals a *wedged* mayor.
The mayor's respawn command has one source of truth — the entrypoint exports
**`NEUTRAL_MAYOR_CMD`** (full pinned claude command, the
`NEUTRAL_HEADLESS_PROMPT` pattern) — used by the supervisor, the watchdog, and
the mayor's own recycle; a hand-reconstructed respawn is LLP 0020's lesson.
The watchdog must recognize `neutral-mayor` by name: its `neutral-*` →
`/work/<name>` mapping would otherwise rebuild the mayor as a reconcile loop.

<a id="recycle"></a>**Context recycle: quiet ∧ context > T** (LLP 0013's shape
with Slack standing in for the repo). *Quiet* is read from the channel — every
recent inbound message from an allowlisted user already has a mayor response
after it; *context* is the LLP 0013 §context-size transcript read. End-of-tick
only, via `NEUTRAL_MAYOR_CMD`. Nothing valuable lives only in the mayor's
context: conversation is in Slack, fleet state is re-derivable, notification
state is the keyed messages (LLP 0042) — a fresh mayor rebuilds its world from
recent channel history in its first tick.

## Consequences

- The entrypoint gains the mayor session, the `NEUTRAL_MAYOR_CMD` export, and
  supervisor duties for mayor + bridge; the watchdog skill gains
  mayor-awareness. Knobs: `NEUTRAL_MAYOR` (default off until a Slack app
  exists), `NEUTRAL_MAYOR_MODEL`.
- `neutral start` (workstation dev loops, LLP 0014) does not spawn a mayor —
  container-only, like the watchdog.
- `@ref LLP 0038 [implements]` — realizes the RFC's fabric half; transport is
  LLP 0040, authority LLP 0041, protocol LLP 0042.
