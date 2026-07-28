# LLP 0040: Slack transport — a Socket Mode bridge daemon, dumb by design

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0034, 0038, 0039

## Context

Spawned by [RFC 0038](0038-mayor-loop.rfc.md) on acceptance. The mayor
(LLP 0039) needs a Slack channel to the human. The transport decides chat
latency, the container's network posture, and where authorization is enforced.

## Decision

<a id="socket-mode"></a>**A small deterministic Node daemon (`slack-bridge`)
holds a Slack Socket Mode connection** — outbound WebSocket only, no inbound
ports, so the container stays deployable on any box. It runs in its own tmux
session, supervised (respawned when dead) by the entrypoint like `hyp-daemon`.
It is container plumbing (like `docker/entrypoint.sh`), outside the
deterministic core's no-runtime-deps rule, but kept dependency-light.

<a id="bridge-dumb"></a>**The bridge is dumb; the mayor is all the judgment.**
Inbound, the bridge does exactly one thing: frame an allowlisted user's
message with provenance and inject it into the mayor's pane with the LLP 0034
send-keys discipline. It parses nothing, decides nothing, answers nothing.

<a id="allowlist"></a>**Authorization is enforced at the bridge,
deterministically.** Messages from users not in `SLACK_ALLOWED_USER_IDS` are
dropped before injection — they never reach the model. Prompt-level filtering
alone would put an open channel one jailbreak away from the fleet.

<a id="outbound-direct"></a>**Outbound bypasses the bridge.** The mayor posts
via `chat.postMessage` with the bot token directly, so notifications still
flow while a dead bridge is being respawned. Only inbound needs the daemon
(something must hold the socket while the mayor sleeps).

## Rejected

- **Polling as primary transport.** `conversations.history` each tick: zero
  new components but reply latency is the wakeup floor (~1–3 min) — SMS, not
  chat. Remains the degraded mode when the bridge is down.
- **Claude in Slack (Claude Tag) as the mayor.** Runs in Anthropic's cloud
  with no path to the container's tmux server, transcripts, or clones — it
  could only self-report, the failure LLP 0002 exists to prevent.
- **A host-side bot process.** Breaks the container as the self-contained
  deploy unit (LLP 0034 §host-cron-rejected grounds).
- **Per-loop Slack presence.** N voices with partial context and inbound
  steering racing each loop's tick; one mayor is the single interlocutor with
  fleet-wide view.

## Consequences

- New Slack app (Socket Mode enabled) with bot + app tokens; config surface
  specced in LLP 0042.
- `@ref LLP 0038 [implements]` — realizes the RFC's transport half.
