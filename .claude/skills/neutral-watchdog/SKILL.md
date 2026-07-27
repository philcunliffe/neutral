---
name: neutral-watchdog
description: One watchdog tick for the neutral-loop container — health-check every reconcile-loop tmux session against transcript ground truth, and heal wedged loops (clear stray input, nudge the live session, or respawn it). Runs as the third loop, `/loop 55m /neutral-watchdog`, inside the container (LLP 0034). Use only there — it assumes the container's shared tmux server and /work layout.
allowed-tools: Bash, Read
---

# neutral-watchdog

One **tick** of the watchdog (LLP 0034). Enumerate the reconcile-loop sessions on
this container's tmux server, decide per session — from ground truth, never
self-report (LLP 0002) — whether it is healthy, working, or wedged, heal what is
wedged, emit one log line per session, and return. `/loop 55m` drives the cadence (55m, not 1h: intervals ≥60 min trigger /loop's interactive cloud-schedule menu, which wedges a headless session).

**This loop is autonomous — never ask a question in the terminal**, never wait for
confirmation. Every decision below is yours to make from observed state.

## Targets

Sessions named `neutral-*` on the local tmux server (`tmux ls -F
'#{session_name}'`), **excluding your own session** (`tmux display-message -p
'#S'`) and `hyp-daemon`. Session `neutral-<name>` ↔ working dir `/work/<name>` ↔
transcripts `~/.claude/projects/-work-<name>/*.jsonl`.

- **`hyp-daemon` is not yours.** The entrypoint supervisor restarts it and
  re-attaches the loops. If it is dead, log it and move on.
- **Never touch your own session** — the supervisor respawns a dead watchdog
  (LLP 0034 §mutual-coverage); you do not self-heal beyond the recycle rule below.
- A repo dir (`/work/*/`) with **no matching session at all** gets a fresh session
  (see Heal, rung 2).

## Per-session health check

1. **Staleness — the authoritative signal.** The newest event **timestamp inside**
   the session's transcripts, never file mtime (mtime is decoupled from content —
   the incident that minted LLP 0034 had mtime 13 h newer than the last event):

   ```bash
   for f in ~/.claude/projects/-work-<name>/*.jsonl; do
     tail -n 20 "$f" | jq -r '.timestamp // empty' | tail -n 1
   done | sort | tail -n 1
   ```

   Newer than **45 minutes** (loops promise ≤30-minute heartbeats, LLP 0013) →
   **healthy**, log and move on.

2. **Pane state** (`tmux capture-pane -p -t <session>`), only for stale sessions:
   - **Working**: a live spinner / "esc to interrupt" footer — a long fan-out can
     be transcript-quiet while agents run. Treat as healthy-busy; do not nudge
     mid-work. If it is still stale *and* the pane is unchanged next tick, treat
     as wedged.
   - **Stray typed-but-unsent text** in the input box: clear it with
     `tmux send-keys -t <session> C-u`. **Never press Enter on text you did not
     type** — it may say anything, including `stop the loop`.
   - **Interactive dialog/menu** (trust prompt, theme picker, permission ask,
     folder-sync menu): do not guess an answer — this is a respawn case.
   - **Idle prompt after an error** (e.g. `API Error` with an empty input box):
     the classic wedge — the turn died before re-arming the heartbeat.

## Heal — gentlest act that works (LLP 0034 §recovery-ladder)

1. **Nudge** (wedged, session alive, no dialog): send one resume message stating
   what you observed, then Enter:

   ```bash
   tmux send-keys -t <session> "keep going - your last transcript event is <ISO time> and no heartbeat is armed. Re-derive ground truth, run a reconcile tick, and re-arm the heartbeat." Enter
   ```

   **Verify submission**: within ~30 s the text must leave the input box and a
   spinner appear; if it still sits in the prompt, send `Enter` once more (the
   first can be swallowed as a paste). Then **verify recovery**: a new transcript
   event within ~5 min (bounded `until` loop re-running the staleness check). The
   nudge is preferred because it keeps the session's accumulated context and lets
   it resume mid-flight work.

2. **Respawn** (nudge failed its verification, interactive dialog, or missing
   session): end the session if present (`tmux kill-session -t <session>`), then
   start it fresh exactly as the entrypoint does:

   ```bash
   tmux new-session -d -s <session> -c /work/<name> \
     "claude --model '${NEUTRAL_MODEL:-claude-opus-5[1m]}' ${NEUTRAL_CLAUDE_ARGS:---dangerously-skip-permissions} --append-system-prompt '$NEUTRAL_HEADLESS_PROMPT' '/loop /neutral-reconcile'"
   ```

   (`NEUTRAL_HEADLESS_PROMPT` is exported by the entrypoint — it tells the
   fresh session it is unattended so it never presents interactive menus.)

   Before ending it, read the pane tail and last transcript events so the log
   line can say what was mid-flight. Nothing that matters is lost: real work is
   already in git/GitHub, and the fresh loop's first tick re-derives everything
   from ground truth (LLP 0002). Verify the respawn the same way — a new
   transcript event within ~5 min.

At most **one** heal attempt per session per tick; if a heal fails verification,
escalate one rung (nudge → respawn) within the same tick, then log and let the
next tick re-check. Never loop retries.

## Log lines

One per target session:

```
watchdog: session=<name> state=<healthy|busy|nudged|respawned|dead-daemon> last_event=<ISO> detail=<...>
```

## End of tick — recycle (LLP 0013/0014)

Return and let `/loop` schedule the next tick. Exception: if **every** session was
healthy this tick and your own context has grown past ~300k tokens, recycle
instead — the tick's last act, targeting your own pane (no `-t`, LLP 0014):

```bash
tmux respawn-pane -k "claude --model '${NEUTRAL_WATCHDOG_MODEL:-${NEUTRAL_MODEL:-claude-opus-5[1m]}}' ${NEUTRAL_CLAUDE_ARGS:---dangerously-skip-permissions} --append-system-prompt '$NEUTRAL_HEADLESS_PROMPT' '/loop 55m /neutral-watchdog'"
```

The model is pinned explicitly via the env knobs — an unpinned respawn would
silently revert the fresh watchdog to the default model (LLP 0020's lesson).
