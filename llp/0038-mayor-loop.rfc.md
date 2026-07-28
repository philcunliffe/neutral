# LLP 0038: The mayor — a fourth loop as the human's Slack interlocutor

**Type:** RFC
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-27
**Related:** 0002, 0010, 0013, 0014, 0019, 0026, 0027, 0034, 0039, 0040, 0041, 0042

## Summary

The container's loops converge repos (reconcile loops) and heal each other
(watchdog, LLP 0034), but none of them *talks to Phil*. The pipeline
deliberately **holds** at human decision points — a PR flipped
ready-for-human-merge (LLP 0019), a stuck report (LLP 0026) — and then waits
silently until a human happens to look. And there is no way to steer a running
loop without SSH-ing into the box and typing into its pane. This RFC proposes a
**fourth loop, `neutral-mayor`** (after the coordinator agent in Gas Town): the
one session whose counterpart is a human over **Slack** rather than git ground
truth. It answers questions about the fleet, pushes the moments that need a
human, and relays human instructions into loop sessions. Real-time chat rides a
small deterministic **Socket Mode bridge daemon**, supervised like `hyp-daemon`.

## Motivation — the fleet has no voice and no ear

Three gaps, all real today:

1. **Held work waits silently.** "Ready for human merge" and "stuck — a human
   must look" are the two states whose whole point is human attention, and
   neither emits a signal. Time-to-human is however long until the next manual
   check.
2. **Steering requires the box.** Redirecting a loop ("prioritize the auth PR")
   means attaching to its tmux pane. The watchdog already built the safe
   send-keys discipline (LLP 0034); only a human-facing front end is missing.
3. **Fleet questions have no interlocutor.** "What is hyparam doing?" is
   answerable from ground truth (`neutral status --json`, transcripts, panes,
   `gh`), but nothing answers it.

The mayor is reconciler-shaped like everything else: its base state is **"the
human has been told about everything that waits on them, and every instruction
they gave has been delivered."** A gap is a held PR or stuck report with no
Slack post about its current hold, or an unanswered human message; a tick
closes those gaps.

## Proposal

### 1. A fourth session, same fabric

`neutral-mayor` runs in `/work` (like the watchdog) as
`claude ... '/loop /neutral-mayor'` — self-paced ticks that scan for
notification gaps, plus instant turns when the bridge injects an inbound
message (an injection into an idle pane starts a turn immediately; into a busy
pane it queues until the turn ends — chat is bridge-speed regardless of tick
cadence). <a id="tick-contract"></a>The mayor promises the **standard
≤30-minute tick** of the LLP 0013 heartbeat contract (settled 2026-07-27,
grill): the tick *is* the notification scan, so the promise bounds push
latency at ~30 minutes, and the watchdog's 45-minute wedge predicate applies
to the mayor unchanged — no special-case threshold.

<a id="mayor-recycle"></a>**Context recycle** (settled 2026-07-27, grill)
follows LLP 0013's shape with Slack standing in for the repo: end-of-tick
recycle iff **quiet ∧ context > T**, where *quiet* is read from the channel
itself — every recent inbound message from an allowlisted user already has a
mayor response after it — and *context* is the LLP 0013 §context-size
transcript read. Nothing valuable lives only in the mayor's context: the
conversation is in Slack, fleet state is re-derivable, notification state is
the keyed messages (§keyed-threads) — so a fresh mayor rebuilds its world,
including "what were we talking about," by reading recent channel history in
its first tick. The respawn uses `NEUTRAL_MAYOR_CMD` (§mayor-cmd). The mayor **never runs reconcile work
itself** — it holds no repo, writes no code, and relays to the loop that owns
the repo, keeping the one-loop-per-repo invariant (LLP 0010/0014) intact.

### 2. The Slack transport: a Socket Mode bridge daemon

A small deterministic Node daemon (`slack-bridge`) holds a Slack **Socket
Mode** connection — outbound WebSocket only, no inbound ports, so it works from
any box the container lands on. Division of labor mirrors the rest of the
system: the bridge is dumb plumbing, the mayor is all the judgment.

- **Inbound**: a message in the configured channel from an **allowlisted Slack
  user ID** is framed with provenance and injected into the mayor's pane —
  `tmux send-keys -t neutral-mayor C-u '[slack <user>] <text>' Enter` — using
  the watchdog's discipline (clear the prefill first; a mid-turn injection is
  queued by the harness as the next user message). Messages from
  non-allowlisted users are dropped at the bridge, deterministically; they
  never reach the model.
- **Outbound**: the mayor posts via `chat.postMessage` with the bot token
  (curl or a tiny `slack-post` helper) — the bridge is not on the outbound
  path, so a mayor tick can notify even while the bridge is being restarted.
- **Supervision**: the entrypoint starts the bridge in its own tmux session
  and the supervisor loop respawns it when dead, exactly like `hyp-daemon`.
- **Config**: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` (Socket Mode),
  `SLACK_CHANNEL_ID`, `SLACK_ALLOWED_USER_IDS`; `NEUTRAL_MAYOR=1` (default off
  until the Slack app exists), `NEUTRAL_MAYOR_MODEL` (same knob shape as the
  watchdog's).

The bridge lives outside the deterministic core's no-runtime-deps rule (it is
container plumbing, like `docker/entrypoint.sh`, not `src/` logic), but it
should still be dependency-light — Socket Mode is a WebSocket plus a couple of
Web API calls.

### 3. Duties (authority: report + relay)

- **Answer** fleet questions from ground truth only — `neutral status --json`
  per `/work/<repo>`, loop transcripts, pane state, `gh` — never a ledger
  (LLP 0002).
- <a id="keyed-threads"></a>**Notify** on human-attention artifacts — a PR
  newly flipped ready-for-human-merge (LLP 0019), a new stuck report
  (LLP 0026) — as **one tagged root message per event**, threading replies
  under it (settled 2026-07-27, grill; was OQ1):
  - The root message's first line is a machine-findable key —
    `[neutral <repo>#<n> <state>@<headSHA>]` — mirroring LLP 0026's
    head-keyed baseline: the same event never posts twice, while a re-stick
    at a new head is a genuinely new key and notifies afresh.
  - **Dedupe is a bounded `conversations.history` scan for the key** (a bot
    token cannot use Slack search), so Slack itself is the ground truth for
    what has been reported — no self-reported notification ledger exists
    (LLP 0002). Bounded lookback and free-plan 90-day retention mean a
    long-ignored artifact may re-announce once past the window — accepted as
    a periodic nag, recorded here so it is stated, not discovered.
  - **Human replies land in the event's thread**, giving the relay duties an
    unambiguous referent — the mayor never infers *which* stuck PR a reply
    answers from prose.
- **Relay** explicit human instructions into a named loop's session with the
  watchdog's send-keys discipline (LLP 0034): clear the prefill, send, verify
  submission, never press Enter on text it did not type. The boundary with the
  watchdog stays clean: the **watchdog touches loop sessions on its own
  judgment to heal; the mayor touches them only on an explicit human request
  to steer.** Every relay confirms back in the event's Slack thread once
  submission is verified (delivered / queued behind a running turn), so the
  human knows their words landed.
- **Relay stuck replies to GitHub** — the second half of the LLP 0026/0027
  conversation loop. When the human answers a relayed stuck report in Slack,
  the mayor posts the reply **verbatim** as a PR comment, **unmarked** (no
  `<!-- neutral-… -->` marker), with a plain-prose attribution footer
  (`— relayed from Slack`). LLP 0027 keys "human reply" on marker *absence*,
  so the relayed comment re-engages the ladder and is fed to workers as
  guidance — the whole stuck→guided→resumed cycle happens in Slack.

<a id="identity-principle"></a>**Identity principle:** authorship, not
transport, decides the marker. Content the human authored (relayed verbatim
from an allowlisted Slack ID) posts **unmarked** — it *is* the human's
comment; the mayor is their fingers, and an attribution footer is prose, not a
marker. Content the **mayor** authors always carries a marker, per LLP 0026's
rule for comments neutral posts. A marker-signed relay would be a no-op by
construction (0027 would classify it as neutral's own comment), which is why
this is a principle and not a style choice.

Human-held acts stay human: the mayor does not merge PRs, close issues, or
approve anything (see OQ2).

### 4. Mutual coverage extends (LLP 0034)

The supervisor gains two deterministic duties: respawn a dead mayor session
and a dead bridge session. The watchdog gains mayor-awareness: today it maps
`neutral-*` sessions to `/work/<name>` repo dirs, so `neutral-mayor` would
confuse it — it must recognize the mayor by name, apply the same
staleness/wedge predicate (§tick-contract), and heal it with the **mayor**
command. <a id="mayor-cmd"></a>That command has one source of truth: the
entrypoint exports **`NEUTRAL_MAYOR_CMD`** (the full pinned claude command,
same pattern as `NEUTRAL_HEADLESS_PROMPT`), and the supervisor, the watchdog,
and the mayor's own context recycle all respawn from it — an unpinned or
hand-reconstructed respawn is exactly LLP 0020's lesson. Neither the mayor nor
the watchdog watches itself; the no-self-reference property of LLP 0034
§mutual-coverage is preserved.

## Open questions

- **OQ1 — settled** (2026-07-27, grill): one tagged root message per event,
  replies threaded under it — see §keyed-threads.
- **OQ2 — merge-from-Slack, deferred on protocol, not authority** (reframed
  2026-07-27, grill). Under §identity-principle a merge command from an
  allowlisted Slack ID **is the human's merge** — LLP 0019's boundary does not
  move; the mayor is the arm. What v1 lacks is the **exact-syntax protocol
  for irreversible acts**: only an unambiguous form (e.g. `merge <repo>#<n>`)
  may trigger one, and the mayor must refuse to infer an irreversible act from
  prose ("yeah go ahead") — misread relays are recoverable (worst case an
  honest re-stick, LLP 0027), misread merges are not. When it lands it is its
  own decision LLP speccing that protocol; out of v1 scope only to keep the
  first mayor minimal.
- **OQ3 — settled** (2026-07-27, grill): the mayor relays Slack replies to
  stuck reports as **unmarked** PR comments — see §3 and the identity
  principle. Kept as a numbered stub so later notes citing OQ3 stay readable.
- **OQ4 — resolved as a noted risk** (2026-07-27, grill): an injection into a
  busy pane queues in the input box until the turn ends, so relays and nudges
  cannot interleave with running work. The only true race — mayor relay and
  watchdog nudge typing into the *same idle pane* in the same seconds — is
  hourly-watchdog × rare-relay small, and both actors already verify
  submission afterward (LLP 0034), which catches a garbled concatenation. No
  mechanism needed.
- **OQ5 — settled** (2026-07-27, grill) by a principle:
  <a id="push-pull"></a>**push only what waits on a human; everything else is
  pull.** v1 pushes exactly three events: a PR flipped ready-for-human-merge
  (LLP 0019), a new stuck report (LLP 0026), and a wedge the watchdog failed
  to heal at both rungs (LLP 0034 — autonomy ended, so it now waits on you).
  Routine health (respawns, daemon restarts) stays in watchdog logs, available
  by asking the mayor. Push events train attention; noise would untrain it.
  The failed-heal event is **re-derived, not reported** (LLP 0002): the mayor
  applies the watchdog's own staleness predicate with a longer horizon — a
  session still wedged after ~2 watchdog cadences means the heal ladder was
  exhausted — rather than reading any watchdog self-report.

## Rejected

- **Polling instead of a bridge.** The mayor's tick could read
  `conversations.history` and self-pace — zero new components, but reply
  latency is the wakeup floor (~1–3 min). Settled against as the primary
  transport: chat that feels like SMS defeats the point of a Slack
  interlocutor. The design keeps the upgrade seam anyway — the mayor skill is
  transport-agnostic (inbound messages are just user turns), so polling
  remains the degraded mode if the bridge is down and Slack is unreachable
  from a pane injection.
- **Claude in Slack (Claude Tag) as the mayor.** Runs in Anthropic's cloud
  with no path to the container's tmux server, transcripts, or clones. It
  cannot observe ground truth, so it could only self-report — the exact
  failure LLP 0002 exists to prevent.
- **A host-side bot process.** Breaks the container as the self-contained
  deploy unit, same grounds as LLP 0034 §host-cron-rejected.
- **Per-loop Slack presence (each reconcile loop chats).** N voices, N
  channels of partial context, and inbound steering racing each loop's tick.
  One mayor is the single interlocutor with fleet-wide view — the Gas Town
  shape.

## Spawns on acceptance

Per house rules an `rfc` stays an `rfc` and spawns its decisions + spec.
Spawned on acceptance (2026-07-27, after the grill settled every OQ):

- [LLP 0039](0039-mayor-fourth-loop.decision.md) — a fourth loop, the mayor:
  converge / heal / converse, tick contract, mutual coverage, recycle.
- [LLP 0040](0040-slack-socket-bridge.decision.md) — Socket Mode bridge as
  the transport; bridge dumb, allowlist at the bridge, outbound direct.
- [LLP 0041](0041-mayor-authority.decision.md) — authority: report + relay,
  the identity principle, push-only-what-waits, no irreversible acts in v1.
- [LLP 0042](0042-slack-bridge-protocol.spec.md) — the bridge protocol:
  framing, keyed threads, dedupe, and the entrypoint/watchdog changes.

## Constraints

- `@ref LLP 0002 [constrained-by]` — every answer is re-derived from git/gh/
  transcript ground truth; notification dedupe reads Slack history, never a
  stored ledger.
- `@ref LLP 0010 [constrained-by]` — the mayor is not a reconcile worker; it
  relays to the loop that owns the repo, preserving one-loop-per-repo.
- `@ref LLP 0013 [constrained-by]` — the mayor is a `/loop` under the
  heartbeat contract; bridge injections are extra turns, not a substitute for
  ticks.
- `@ref LLP 0014 [constrained-by]` — session naming: `neutral-mayor` joins the
  `neutral-*` namespace and the watchdog's name→dir mapping must special-case
  it.
- `@ref LLP 0019 [constrained-by]` — the human's merge stays the one
  irreversible act; the mayor surfaces holds, it does not clear them.
- `@ref LLP 0026 [constrained-by]` / `@ref LLP 0027 [constrained-by]` — stuck
  reports are the push-notification payload; a relayed Slack reply posts
  unmarked so 0027's marker-absence predicate counts it as the human's
  (§identity-principle).
- `@ref LLP 0034 [constrained-by]` — reuses the send-keys discipline and
  extends mutual coverage: supervisor heals mayor + bridge, watchdog gains
  mayor-awareness, nobody watches itself.
