# LLP 0057: Outage sentinel — a deterministic last line notifies Slack when the fleet goes silent

**Type:** Decision
**Status:** Active
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0002, 0013, 0034, 0039, 0040, 0042

## Context

A Claude API outage (July 2026) silenced the whole container at once: the repo
loops, the watchdog (LLP 0034), and the mayor (LLP 0039) are all LLM sessions,
so the outage took out the alarm together with the workers. The deterministic
supervisor (`docker/entrypoint.sh`) kept respawning sessions but notifies
no one — it has no Slack path. Nobody knew until a human looked. Every
notification path today routes through a model; the one failure mode that
needs notifying most — *no model available* — is exactly the one none of them
survives. The same blindness covers fleet-wide non-API causes: a stale
`ANTHROPIC_BASE_URL` after a gateway re-attach clobber, a revoked credential,
a wedge storm the watchdog itself fell into.

## Decision

<a id="sentinel"></a>**A deterministic Node daemon, `outage-sentinel`, runs in
the container as the last line of defense.** Like `slack-bridge` (LLP 0040) it
is container plumbing — dependency-light, its own tmux session, respawned by
the supervisor when dead. It contains **no model calls and no claude
dependency of any kind**: its inputs are transcript files and `tmux
list-sessions`; its output is Slack. An API outage cannot take it down.

<a id="fleet-silence"></a>**The trigger is fleet-wide silence, read as ground
truth (LLP 0002).** A *sign of life* is a **`usage`-carrying event** in any
session transcript (`~/.claude/projects/*/*.jsonl`) — the API's own record of
a completed model turn, the same read LLP 0013 uses for context size. Not
file mtime (LLP 0034's incident), and not mere transcript events: a fleet
erroring on every request still writes session-start records as the
supervisor respawns it, but produces no `usage` — so respawn churn cannot
mask an outage. The fleet is **silent** when the newest usage event across
*all* sessions is older than `NEUTRAL_SENTINEL_SILENCE_MIN` (default 60;
healthy loops heartbeat ≤30 min and the watchdog ticks at 55, so an hour of
total silence is never normal). At container boot the clock starts at boot
time, so a container born into an outage — or born misattached — still fires
after one threshold.

<a id="notify-only"></a>**The sentinel notifies; it never heals.** It sends no
keys, kills no sessions, respawns nothing. LLP 0034 §shell-check-rejected
stands in full: recovery is judgment and belongs to the watchdog. The
coverage ladder becomes three rungs, each covering the one below's blind
spot: the **supervisor** respawns what is *dead* (deterministic), the
**watchdog** heals what is *wedged* (judgment), the **sentinel** tells the
human when *both of those are themselves down* (deterministic, voice only).
Neither deterministic rung watches itself; the sentinel's own death is the
supervisor's to respawn, and a dead supervisor means a dead container —
§external-heartbeat's rung.

<a id="notify-direct"></a>**Outbound is direct `chat.postMessage`** with
`SLACK_BOT_TOKEN` to `SLACK_CHANNEL_ID` — the LLP 0040 §outbound-direct path;
no bridge, no mayor, no model on the path. The alert is a fixed template
whose first-line key follows LLP 0042: `[neutral fleet
silent-since@<lastUsageISO>]`, enriched with facts the sentinel can read
deterministically: which tmux sessions exist, and a reachability probe of the
attached gateway port and `api.anthropic.com` (an unauthenticated request
answering *anything* proves reachability — distinguishing "API down" from
"container misconfigured"). Probes and status pages **decorate the alert,
never trigger it** — the trigger is observed silence only. Dedupe is the
LLP 0042 §dedupe history scan for the key (silence-start timestamp = incident
identity; no state file, LLP 0002); an ongoing incident re-posts a thread
reply every 6 h; recovery posts `[neutral fleet recovered@<firstUsageISO>]`
under the same root and the incident is closed.

<a id="external-heartbeat"></a>**Optional fourth rung: an external dead-man's
switch.** When `NEUTRAL_HEARTBEAT_URL` is set, every sentinel pass also GETs
it (healthchecks.io-shaped: the *absence* of pings alerts, from outside). This
is the only rung that survives container or host death — the one failure the
sentinel cannot report from inside. Opt-in, one `fetch`, no inbound surface.

## Rejected

- **Making the watchdog non-LLM, or adding heal powers here.** Re-litigates
  LLP 0034: healing needs judgment. The gap was never healing — it was voice.
- **A host cron/agent.** LLP 0034 §host-cron-rejected grounds; the container
  stays the self-contained deploy unit. Host/container death is instead
  §external-heartbeat's rung — notification from outside, still no host
  config on the *recovery* path.
- **Status-page polling as the trigger.** `status.anthropic.com` reports
  Anthropic's outages, not this container's (bad token, dead gateway, wedge
  storm all show green). Observed silence covers every cause; the status page
  is at most alert decoration.
- **Routing the alert through the mayor.** The mayor is an LLM session — down
  in exactly the scenario this exists for.

## Consequences

- Config surface grows: `NEUTRAL_SENTINEL` (default `1` when
  `SLACK_BOT_TOKEN` + `SLACK_CHANNEL_ID` are set, independent of
  `NEUTRAL_MAYOR` — alerting must not require the mayor), 
  `NEUTRAL_SENTINEL_SILENCE_MIN` (default 60), `NEUTRAL_HEARTBEAT_URL`
  (optional).
- Entrypoint: spawn `outage-sentinel` session; supervisor respawns it when
  dead (same shape as `slack-bridge`/`hyp-daemon`).
- The silence classifier — `(sessions' newest usage timestamps, bootTime,
  now, threshold) → {silent, since}` — is a pure function in the
  deterministic core (`src/silence.js`, alongside `prhealth.js`), unit-tested
  offline; only the daemon (`docker/outage-sentinel.js`) touches fs, tmux,
  and the network.
- The LLP 0034 ladder gains its missing failure mode: a fleet-wide outage is
  now *reported* within ~1 h even though nothing can heal it from inside.
