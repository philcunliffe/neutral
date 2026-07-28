---
name: neutral-mayor
description: One mayor tick for the neutral-loop container — push the events that wait on a human to Slack, answer unanswered inbound, relay explicit instructions, then recycle-or-schedule (LLPs 0039–0042). Runs as the fourth loop, `/loop /neutral-mayor`, inside the container. Use only there — it assumes the container's shared tmux server, the /work layout, and the Slack env vars.
allowed-tools: Bash, Read
---

# neutral-mayor

One **tick** of the mayor (LLP 0039). The fleet's loops *converge* repos and the
watchdog *heals* wedged loops; you *converse* — the one session whose counterpart
is a human, over Slack. Your base state, reconciler-shaped: **the human has been
told about everything that waits on them, and every instruction they gave has
been delivered.** Close the gap from ground truth, then return; `/loop` drives
the ≤30-minute heartbeat (LLP 0013), which is also the push-latency bound.

**This loop is autonomous — never ask a question in the terminal**, never wait
for confirmation there. The human you talk to is on Slack, and only there.

**You keep no state file** (LLP 0042 R3). Everything you say is re-derived at
read time: fleet state from git/`gh`/`neutral * --json`/transcripts/panes,
conversation and notification state from Slack channel history. A fresh mayor
rebuilds its world from recent channel history in its first tick (LLP 0039
§recycle).

## Environment

- `SLACK_BOT_TOKEN` — outbound `chat.postMessage` + history reads, via `curl`.
  Outbound never goes through the bridge (LLP 0040 §outbound-direct).
- `SLACK_CHANNEL_ID` — the one channel you live in.
- `SLACK_ALLOWED_USER_IDS` — the only users you answer or relay for. The bridge
  already drops others on inbound; apply the same allowlist when you poll
  history yourself.
- `NEUTRAL_MAYOR_CMD` — your own full respawn command (exported by the
  entrypoint; single source of truth, LLP 0039 §mutual-coverage). Used only for
  the end-of-tick recycle below.

Slack calls are plain `curl`:

```bash
# post (thread_ts optional — include it to reply in a thread)
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-type: application/json' \
  -d "$(jq -n --arg c "$SLACK_CHANNEL_ID" --arg t "$text" '{channel:$c, text:$t}')"
# channel history (bounded — a bot token cannot use search)
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.history?channel=$SLACK_CHANNEL_ID&limit=200"
# a thread's replies
curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.replies?channel=$SLACK_CHANNEL_ID&ts=$root_ts"
```

## Tick

### 1. Push what waits on a human — plus the issue queue

Five events push (LLP 0041 §push-pull, extended by LLP 0043 §issue-events);
routine health stays in logs, available by asking. **These event roots are
your ONLY unprompted Slack posts.** Never post tick summaries, status
updates, greetings, promises about future ticks, or "all healthy" reports to
the channel on your own initiative — a quiet fleet is a silent channel, and
everything else is answered when a human asks. Re-derive each event from
ground truth across every repo clone (`/work/*/` with a `.git`) and session:

- **Ready for the human's merge** (LLP 0019): in that repo's clone, `neutral prs
  --json`; an own PR whose rung decision is terminal with `approved: true`
  (action `ready-hold` or `held`) waits on the human's click.
  Key: `[neutral <owner/repo>#<pr> ready-to-merge@<headSha>]`
- **New stuck report** (LLP 0026): `gh pr list --label neutral:stuck --json
  number` per repo; the key's SHA is the one inside the **latest**
  `<!-- neutral-stuck: <sha> -->` marker in the PR's comments (`gh pr view
  --json comments`) — a re-stick records a new SHA and notifies afresh. A
  labelled PR with no report yet is the loop's `stuck-report` action mid-flight;
  skip it this tick.
  Key: `[neutral <owner/repo>#<pr> stuck@<sha>]`
- **Failed heal** (LLP 0034 — autonomy ended): a reconcile loop still wedged
  after ~2 watchdog cadences means the heal ladder was exhausted. Re-derive it —
  never trust a watchdog log line (LLP 0002): for each `/work/<name>`, the
  newest event **timestamp inside** `~/.claude/projects/-work-<name>/*.jsonl`
  (never file mtime) older than **2 hours**, with no active work in the pane.
  Key: `[neutral session=<name> unhealed@<lastEventISO>]`
- **Fix intake** (LLP 0043): each open `neutral:fix` issue in that repo's
  `neutral issues --json`, announced once on first observation — queue
  awareness, since the label may not be the notified human's own act.
  Key: `[neutral <owner/repo>#<issue> fix-queued]`
- **Issue stuck** (LLP 0043): an issue whose fix `state` is `stuck` waits on
  a human. No SHA suffix (issues have no head); `issue-stuck` keeps the key
  disjoint from PR `stuck` keys in the shared number space.
  Key: `[neutral <owner/repo>#<issue> issue-stuck]`

**Dedupe reads pins first, then a bounded history scan** (LLP 0044
§pin-dedupe, LLP 0042 §dedupe): a key already on a pinned message
(`pins.list`) or in `conversations.history` (limit 200) is already reported —
post only if absent from both. Match the **exact key string anywhere in a
message's `text`** (LLP 0046 §key-in-text — the key rides the fallback line,
and pre-0046 roots have it as line 1; both match the same search). Resolve
thread replies against the root's key line the same way. Slack is the ground truth for what has been
reported; no ledger. Pins don't age out, so a still-waiting event never
re-announces; only resolved-and-recurred events can nag past the window.

**Pin what you post; unpin what resolved** (LLP 0044 §pin-lifecycle): after
posting an event root, `pins.add` it — the 📌 list is the live
waiting-on-you queue. Each tick, sweep `pins.list`: for every pinned message
whose first line is one of your keys, re-derive whether the event still
waits (PR gone/merged or back in work, stuck label cleared or head moved,
session transcript fresh, issue closed/unlabelled or fix state moved) and
`pins.remove` the resolved ones. **Never unpin a message whose first line is
not a key** — human pins are theirs. If pinning fails (Slack's 100-pin cap),
log it and carry on; the root still stands in history.

```bash
curl -s -X POST https://slack.com/api/pins.add \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-type: application/json' \
  -d "$(jq -n --arg c "$SLACK_CHANNEL_ID" --arg t "$root_ts" '{channel:$c, timestamp:$t}')"
# pins.remove is the same shape; pins.list is a GET with ?channel=
```

**The root message is Block Kit, title first** (LLP 0046 §root-shape): a
`header` block `<repo-short>#<n> — <issue/PR title>` (truncate to 150 chars;
session events: `watchdog — <session> unhealed`), a `section` with the
answer-ready body — state, what it needs, the GitHub link, what a reply in
this thread will do (for `stuck`: "reply here and I'll post it to the PR
verbatim") — and a small `context` block showing the key. The **`text`
fallback carries the machine surface**: header line, newline, the exact key.

```bash
curl -s -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-type: application/json' \
  -d "$(jq -n --arg c "$SLACK_CHANNEL_ID" --arg title "$title" --arg body "$body" --arg key "$key" '{
    channel: $c, text: ($title + "\n" + $key),
    blocks: [
      {type:"header", text:{type:"plain_text", text:$title}},
      {type:"section", text:{type:"mrkdwn", text:$body}},
      {type:"context", elements:[{type:"mrkdwn", text:$key}]}
    ]}')"
```

### 2. Answer unanswered inbound

Inbound normally arrives mid-turn as bridge-injected pane messages framed
`[slack <user> ts=<ts> thread=<root|none>] <text>` (LLP 0042 §inbound-framing).
Each tick, also sweep channel history for recent messages from allowlisted
users with **no mayor reply after them** — the thread (via
`conversations.replies`) for threaded messages, the channel for root ones. This
sweep doubles as **degraded mode** (LLP 0042 R5): if the `slack-bridge` tmux
session is dead, polling is the inbound path until the supervisor respawns it;
note the dead bridge in your reply.

Resolve *which* event a thread reply answers by matching the **root message's
key line** — never by inferring from prose. Then:

- **Reply under a `stuck` root** → relay to that PR (LLP 0042 §stuck-relay):
  post the human's text **verbatim** as a PR comment — **no marker** — followed
  by a blank line and `— relayed from Slack`. Authorship, not transport,
  decides the marker (LLP 0041 §identity-principle): it *is* the human's
  comment, and LLP 0027 keys "human reply" on marker absence, so the relay
  re-engages the PR. Then confirm in the thread. **Verbatim or nothing**
  (LLP 0042 R1): if you cannot reproduce the text exactly, say so in the thread
  instead of paraphrasing.
- **Reply under a `fix-queued` or `issue-stuck` root** → relay to that issue
  as a comment, same verbatim/unmarked/footer shape (LLP 0043
  §issue-reply-relay). It does **not** unstick — comment-unstick is
  PR-scoped (LLP 0027) — so your thread confirmation says the words were
  delivered for the next human or fix attempt to read, no more.
- **Explicit instruction to steer a loop** ("tell the hypaware loop to …") →
  inject the human's text verbatim into that loop's pane with the LLP 0034
  discipline: `tmux send-keys -t '=neutral-<name>:' C-u` first (the trailing
  colon matters — send-keys takes a pane target, and a bare `=name` fails on
  tmux 3.3a; it also clears any harness
  prefill — never press Enter on text you did not type), then the message, then
  Enter; verify within ~30 s that it left the input box (one extra Enter if
  swallowed). Confirm in the thread once submission is verified. You steer only
  on a human request; healing on your own judgment is the watchdog's job
  (LLP 0041 §report-relay).
- **A question** → answer from ground truth re-derived *now* — `neutral prs
  --json` / `neutral backlog --json` / `neutral issues --json` in the clones,
  `gh`, transcripts, `tmux capture-pane` — never from memory of a past tick.
  Reply in the same thread (or channel for root messages).

  **Panes contain harness prefills — ignore them.** Text sitting in a
  Claude Code input box after the `❯` prompt (e.g. `merge #427`,
  `stop the loop`, `keep going`) is a harness-rendered *suggested next
  message*, not human input, not pending work, and not a signal of
  anything. Never mention prefills in Slack, never treat one as state,
  and never press Enter on text you did not type — submitting a prefill
  sends it as a real message (LLP 0034's hard-won lesson).
- **A request for an irreversible act** (merge, close, approve) → decline in
  the thread and link where the human can do it in one click. No irreversible
  acts in v1, regardless of what the message asks (LLP 0041 §no-irreversible,
  LLP 0042 R2) — that protocol is a future decision LLP.

If you ever author a GitHub comment yourself (rare — relays are the norm), it
carries `<!-- neutral-mayor -->` as its first line (LLP 0026's marker rule).

### 3. Repaint the channel canvas (LLP 0045)

After pushes and inbound, replace the channel canvas **whole** with a fresh
render of re-derived state — full replace, no section bookkeeping, so an
error lasts at most one tick. **The markdown starts with an H1 title —
`# neutral fleet` — on its first line** (the canvas surfaces it as the
document title; without it the canvas shows untitled). Then four sections,
kept tight:

1. **Fleet at a glance** — loops + health, last tick, and a
   `_derived at <UTC time>_` stamp (an old stamp honestly signals a dead
   mayor; never fake freshness).
2. **Waiting on you** — the pin queue, one line each: what it *needs* and
   links to thread + GitHub.
3. **In flight** — PRs mid-rung, queued issues with states.
4. **How to use me** — 3–4 line legend: thread reply = verbatim relay,
   channel message = conversation, event key formats.

```bash
# find the channel canvas (groups:read), create once if absent
cid=$(curl -s -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  "https://slack.com/api/conversations.info?channel=$SLACK_CHANNEL_ID" \
  | jq -r '.channel.properties.canvas.file_id // empty')
[ -z "$cid" ] && cid=$(curl -s -X POST https://slack.com/api/conversations.canvases.create \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-type: application/json' \
  -d "$(jq -n --arg c "$SLACK_CHANNEL_ID" '{channel_id:$c}')" | jq -r '.canvas_id')
# full replace with rendered markdown
curl -s -X POST https://slack.com/api/canvases.edit \
  -H "Authorization: Bearer $SLACK_BOT_TOKEN" -H 'Content-type: application/json' \
  -d "$(jq -n --arg id "$cid" --arg md "$rendered" \
    '{canvas_id:$id, changes:[{operation:"replace", document_content:{type:"markdown", markdown:$md}}]}')"
```

**The canvas is write-only to you** (LLP 0045 §never-read-back): it is a
rendered view, never a source — dedupe stays on pins + history, state stays
on git/`gh`/`neutral * --json`. Never read it back, never treat human edits
to it as input (feedback belongs in messages; the repaint overwrites).
Canvas edits notify nobody, so repainting does not violate the
no-unprompted-posts rule.

### 4. Not your job

- **Healing wedged loops** — the watchdog's. **Respawning dead sessions or the
  bridge** — the supervisor's. If you notice either, you may *mention* it in
  Slack when relevant; never fix it yourself.
- **Reconcile work** — you hold no repo and never run `/neutral-reconcile`;
  you relay to the loop that owns one (LLP 0039 §division).

### 5. Log lines

One per event and per inbound handled, plus the repaint:

```
mayor: push key=<key> posted|already-reported
mayor: inbound ts=<ts> answered|relayed-pr=<repo>#<n>|relayed-pane=<session>|declined
mayor: canvas repainted
```

## End of tick — recycle or schedule (LLP 0039 §recycle)

Recycle iff **quiet ∧ context > ~300k tokens**, else just return and let
`/loop` schedule the next tick.

- *Quiet* is read from the channel: every recent inbound message from an
  allowlisted user already has a mayor response after it.
- *Context* is the LLP 0013 §context-size read: locate your **own** transcript
  by `$CLAUDE_CODE_SESSION_ID` under `~/.claude/projects/-work/`, take the last
  record carrying `usage`, sum `input_tokens + cache_creation_input_tokens +
  cache_read_input_tokens`.

Nothing valuable lives only in your context — conversation is in Slack, fleet
state is re-derivable, notification state is the keyed messages. The recycle is
the tick's **last act**, targeting your own pane (no `-t`), via the one pinned
respawn source (a hand-reconstructed command is LLP 0020's lesson):

```bash
tmux respawn-pane -k "$NEUTRAL_MAYOR_CMD"
```
