#!/usr/bin/env bash
# Container entrypoint: clone each repo in $NEUTRAL_REPOS, start one detached
# tmux session per repo running the reconcile loop, then supervise. Mirrors
# `neutral start` (src/commands/start.js): same loop command, same per-repo
# session naming, tmux pane as the autophagy respawn context (LLP 0013/0014).
set -euo pipefail

log() { printf '[neutral-loop] %s\n' "$*"; }

# --- preflight ---------------------------------------------------------------

if [ -z "${NEUTRAL_REPOS:-}" ]; then
  echo "NEUTRAL_REPOS is empty — set it at build time (--build-arg NEUTRAL_REPOS=\"owner/a owner/b\")" >&2
  echo "or at run time (-e NEUTRAL_REPOS=\"owner/a owner/b\")." >&2
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  log "WARNING: neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set — claude will not authenticate."
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated — pass -e GH_TOKEN=... (a token with repo scope)." >&2
  exit 1
fi

# Git identity for the commits the loop's workers make.
git config --global user.name  "${GIT_AUTHOR_NAME:-neutral-loop}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-neutral-loop@localhost}"
gh auth setup-git

MODEL="${NEUTRAL_MODEL:-claude-opus-5[1m]}"
CLAUDE_ARGS="${NEUTRAL_CLAUDE_ARGS:---dangerously-skip-permissions}"

# Every claude session in this container is unattended. This harness-level
# system prompt suppresses interactive offers (e.g. /loop's cloud-schedule
# menu at >=60m intervals) that would wedge a headless pane. Exported so the
# skills' tmux respawn commands can reuse it; no apostrophes — it is embedded
# single-quoted in the session commands below.
export NEUTRAL_HEADLESS_PROMPT="Headless autonomous session: no human is at this terminal. Never present interactive menus, choices, or questions in the terminal. When a skill or tool offers options (for example /loop offering a cloud schedule), silently take the session-local non-interactive path and continue."

# Model single-quoted so sh doesn't glob the [1m] brackets (see LOOP_SHELL_COMMAND).
LOOP_CMD="claude --model '$MODEL' $CLAUDE_ARGS --append-system-prompt '$NEUTRAL_HEADLESS_PROMPT' '/loop /neutral-reconcile'"

# --- mayor command (LLP 0039/0042) --------------------------------------------
# The mayor's respawn command has ONE source of truth — this export — shared by
# the supervisor below, the watchdog's heal, and the mayor's own end-of-tick
# recycle (LLP 0039 §mutual-coverage; a hand-reconstructed respawn is LLP 0020's
# lesson). Exported unconditionally and BEFORE the first tmux call, so it lands
# in the tmux server environment every later session inherits.
MAYOR="${NEUTRAL_MAYOR:-0}"
MAYOR_SESSION="neutral-mayor"
BRIDGE_SESSION="slack-bridge"
MAYOR_MODEL="${NEUTRAL_MAYOR_MODEL:-$MODEL}"
export NEUTRAL_MAYOR_CMD="claude --model '$MAYOR_MODEL' $CLAUDE_ARGS --append-system-prompt '$NEUTRAL_HEADLESS_PROMPT' '/loop /neutral-mayor'"
BRIDGE_CMD="node /opt/neutral/docker/slack-bridge.js"

# Opting in without the Slack app configured is a config error — die loudly at
# boot rather than limping into a mayor that can neither hear nor speak
# (config surface: LLP 0042).
if [ "$MAYOR" = "1" ]; then
  for v in SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_CHANNEL_ID SLACK_ALLOWED_USER_IDS; do
    if [ -z "${!v:-}" ]; then
      echo "NEUTRAL_MAYOR=1 but $v is unset — create the Slack app and pass the LLP 0042 config surface, or set NEUTRAL_MAYOR=0." >&2
      exit 1
    fi
  done
fi

# sessionName(): chars outside [A-Za-z0-9_-] collapse to '-'.
sanitize() { printf '%s' "$1" | sed -e 's/[^A-Za-z0-9_-]\{1,\}/-/g' -e 's/^-*//' -e 's/-*$//'; }

# The gateway port claude is currently attached at. The daemon's attach
# reconciler rewrites this whenever the gateway rebinds (it may listen on an
# ephemeral port under a centrally-claimed config), so always re-read it —
# never cache it.
attached_port() { jq -r '._hypaware.port // empty' "$HOME/.claude/settings.json" 2>/dev/null; }

# Wait until the attached port answers HTTP (any response counts; connection
# refused means not up yet). Prints the port on success.
wait_gateway() {
  local p
  for _ in $(seq 1 60); do
    p=$(attached_port)
    if [ -n "$p" ] && curl -s -o /dev/null "http://127.0.0.1:$p/"; then
      printf '%s' "$p"
      return 0
    fi
    sleep 1
  done
  return 1
}

spawn_loop() { # $1 = working dir, $2 = session name, $3 = loop command
  tmux new-session -d -s "$2" -c "$1" "$3"
}

# --- hypaware capture (optional, on by default) --------------------------------
# Order matters: init + attach must happen BEFORE the loops start, because
# attach rewrites claude's settings (gateway ANTHROPIC_BASE_URL + hooks) and a
# claude process only reads them at startup. The daemon hosts the gateway, so
# it must be up first or every claude request hits a dead port.

HYPAWARE="${NEUTRAL_HYPAWARE:-1}"
if [ "$HYPAWARE" = "1" ]; then
  if [ ! -f "$HOME/.hyp/hypaware-config.json" ]; then
    log "hypaware: initializing (claude capture, no service install)"
    hyp init --yes --no-daemon
  fi

  # Central forwarding uses `hyp join` — the headless fleet-enrollment path.
  # (`hyp remote login` with a static token is query-only by design; only the
  # attended browser flow enrolls forwarding. Join writes the central-plugin
  # seed config that the daemon below picks up.)
  if [ -n "${HYP_REMOTE_URL:-}" ] && [ -n "${HYP_REMOTE_TOKEN:-}" ]; then
    # Join tokens are single-use, and the daemon consumes seed.json into the
    # config-control a/b slots on first contact — so "already enrolled" is
    # state.json (or a not-yet-consumed seed), never just seed.json. Mount a
    # volume at ~/.hyp so enrollment survives container recreation; re-joining
    # with a spent token would fail the boot.
    if [ -f "$HOME/.hyp/hypaware/config-control/state.json" ] || [ -f "$HOME/.hyp/hypaware/config-control/seed.json" ]; then
      log "hypaware: already joined a fleet — skipping join"
    else
      log "hypaware: joining fleet at $HYP_REMOTE_URL as host '$(hostname)'"
      # Token via 0600 file, not argv (argv shows in process listings). The
      # umask is scoped to the token write — a broad umask here would strip
      # the execute bit from directories hyp creates.
      (umask 177 && printf '%s' "$HYP_REMOTE_TOKEN" > /tmp/hyp-join-token)
      hyp join "$HYP_REMOTE_URL" --token-file /tmp/hyp-join-token --no-daemon
      rm -f /tmp/hyp-join-token
    fi
  elif [ -f "$HOME/.hyp/hypaware/config-control/state.json" ]; then
    log "hypaware: already joined a fleet (enrollment persisted in ~/.hyp volume) — central sync active"
  else
    log "hypaware: no HYP_REMOTE_URL/HYP_REMOTE_TOKEN — capturing locally only, no central sync"
  fi

  tmux new-session -d -s hyp-daemon 'hyp daemon run --foreground'

  # A recreated container has a fresh filesystem layer: ~/.hyp (volume) still
  # holds a done attach marker, but the claude settings that marker points at
  # died with the old layer — and the daemon then never re-attaches. Standalone
  # attach reads the daemon's live port and is idempotent, so always run it.
  for _ in $(seq 1 30); do
    hyp attach claude >/dev/null 2>&1 && break
    sleep 2
  done

  if port=$(wait_gateway); then
    log "hypaware: gateway up on 127.0.0.1:$port"
  else
    log "WARNING: hypaware gateway did not come up — loops may fail until it does"
  fi
fi

# --- clone + launch, one session per repo (LLP 0014) --------------------------

SESSIONS=()
DIRS=()
CMDS=()
for repo in $(printf '%s' "$NEUTRAL_REPOS" | tr ',' ' '); do
  name=$(basename "$repo")
  dir="/work/$name"
  if [ ! -d "$dir/.git" ]; then
    log "cloning $repo -> $dir"
    gh repo clone "$repo" "$dir"
  else
    log "$dir already cloned — reusing (state is derived from git, so this is safe)"
  fi

  # Pre-trust the clone so claude never stops at the interactive trust dialog.
  jq --arg dir "$dir" \
     '.projects[$dir] = ((.projects[$dir] // {}) + {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true})' \
     ~/.claude.json > ~/.claude.json.tmp && mv ~/.claude.json.tmp ~/.claude.json

  # Pre-classify the folder for sync so hypaware's classify-cwd hook never
  # pops its folder-sync menu inside the loop — an interactive question wedges
  # an autonomous session. Running loops in this container to forward their
  # logs IS the point, so "sync" is the right durable answer.
  if [ "$HYPAWARE" = "1" ]; then
    hyp ignore --sync "$dir" >/dev/null || log "WARNING: could not pre-classify $dir for sync"
  fi

  session="neutral-$(sanitize "$name")"
  SESSIONS+=("$session")
  DIRS+=("$dir")
  CMDS+=("$LOOP_CMD")
  if tmux has-session -t "=$session" 2>/dev/null; then
    log "session $session already running"
  else
    log "starting loop for $repo in tmux session $session"
    spawn_loop "$dir" "$session" "$LOOP_CMD"
  fi
done

# --- watchdog (LLP 0034) ------------------------------------------------------
# A live-but-silent claude session is invisible to the supervisor below (it only
# sees dead sessions). The watchdog is a third LLM loop that hourly reads each
# loop's transcript ground truth and nudges or respawns wedged loops. Division
# of labor: the supervisor heals the watchdog (deterministic), the watchdog
# heals the loops (judgment) — neither watches itself.
WATCHDOG="${NEUTRAL_WATCHDOG:-1}"
WATCHDOG_SESSION="neutral-watchdog"
# The watchdog's model is independently overridable (its ticks are mostly
# mechanical checks); empty means "same as the loops".
WATCHDOG_MODEL="${NEUTRAL_WATCHDOG_MODEL:-$MODEL}"
# 55m, not 1h: /loop offers an interactive "cloud schedule?" menu for
# intervals ≥60 min, which wedges a headless session at the menu. The
# headless system prompt above is the second line of defense.
WATCHDOG_CMD="claude --model '$WATCHDOG_MODEL' $CLAUDE_ARGS --append-system-prompt '$NEUTRAL_HEADLESS_PROMPT' '/loop 55m /neutral-watchdog'"
if [ "$WATCHDOG" = "1" ]; then
  # The watchdog runs in /work (not a repo clone) — pre-trust it and pre-classify
  # it for hypaware sync, same as the repo dirs, so nothing interactive wedges it.
  jq '.projects["/work"] = ((.projects["/work"] // {}) + {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true})' \
     ~/.claude.json > ~/.claude.json.tmp && mv ~/.claude.json.tmp ~/.claude.json
  if [ "$HYPAWARE" = "1" ]; then
    hyp ignore --sync /work >/dev/null || log "WARNING: could not pre-classify /work for sync"
  fi

  SESSIONS+=("$WATCHDOG_SESSION")
  DIRS+=(/work)
  CMDS+=("$WATCHDOG_CMD")
  if tmux has-session -t "=$WATCHDOG_SESSION" 2>/dev/null; then
    log "session $WATCHDOG_SESSION already running"
  else
    log "starting watchdog in tmux session $WATCHDOG_SESSION"
    spawn_loop /work "$WATCHDOG_SESSION" "$WATCHDOG_CMD"
  fi
fi

# --- mayor + slack bridge (LLP 0039/0040) -------------------------------------
# The fourth loop: the mayor converses with the human over Slack. The bridge is
# the inbound plumbing only — a dumb Socket Mode daemon that drops everything
# but allowlisted users' messages before anything reaches a model; outbound
# (chat.postMessage) bypasses it entirely. Division of labor mirrors the
# watchdog's: the supervisor below respawns a DEAD bridge or mayor
# (deterministic); a WEDGED mayor is the watchdog's to heal (LLP 0039
# §mutual-coverage).
if [ "$MAYOR" = "1" ]; then
  # The mayor runs in /work like the watchdog — same pre-trust + sync classify
  # (idempotent; repeated here so the mayor doesn't depend on the watchdog knob).
  jq '.projects["/work"] = ((.projects["/work"] // {}) + {hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true})' \
     ~/.claude.json > ~/.claude.json.tmp && mv ~/.claude.json.tmp ~/.claude.json
  if [ "$HYPAWARE" = "1" ]; then
    hyp ignore --sync /work >/dev/null || log "WARNING: could not pre-classify /work for sync"
  fi

  if tmux has-session -t "=$BRIDGE_SESSION" 2>/dev/null; then
    log "session $BRIDGE_SESSION already running"
  else
    log "starting slack bridge in tmux session $BRIDGE_SESSION"
    tmux new-session -d -s "$BRIDGE_SESSION" "$BRIDGE_CMD"
  fi

  SESSIONS+=("$MAYOR_SESSION")
  DIRS+=(/work)
  CMDS+=("$NEUTRAL_MAYOR_CMD")
  if tmux has-session -t "=$MAYOR_SESSION" 2>/dev/null; then
    log "session $MAYOR_SESSION already running"
  else
    log "starting mayor in tmux session $MAYOR_SESSION"
    spawn_loop /work "$MAYOR_SESSION" "$NEUTRAL_MAYOR_CMD"
  fi
fi

# --- outage sentinel (LLP 0057) -----------------------------------------------
# The deterministic last line of defense: every other voice here (loops,
# watchdog, mayor) is a Claude session, so a fleet-wide failure — an API
# outage, a dead gateway attach, a revoked credential — silences the alarm
# together with the workers. The sentinel has no model on its path: it reads
# transcript tails for the fleet's newest completed model turn and posts to
# Slack directly (chat.postMessage) when the whole fleet goes silent. It
# notifies only — healing stays with the watchdog (LLP 0034). Default: on
# whenever the Slack outbound surface exists, independent of NEUTRAL_MAYOR.
SENTINEL_SESSION="outage-sentinel"
SENTINEL_CMD="node /opt/neutral/docker/outage-sentinel.js"
if [ -n "${NEUTRAL_SENTINEL:-}" ]; then
  SENTINEL="$NEUTRAL_SENTINEL"
elif [ -n "${SLACK_BOT_TOKEN:-}" ] && [ -n "${SLACK_CHANNEL_ID:-}" ]; then
  SENTINEL=1
else
  SENTINEL=0
  log "WARNING: no SLACK_BOT_TOKEN/SLACK_CHANNEL_ID — outage sentinel disabled; a fleet-wide outage will go unreported"
fi
if [ "$SENTINEL" = "1" ]; then
  for v in SLACK_BOT_TOKEN SLACK_CHANNEL_ID; do
    if [ -z "${!v:-}" ]; then
      echo "NEUTRAL_SENTINEL=1 but $v is unset — pass the Slack outbound surface (LLP 0042), or set NEUTRAL_SENTINEL=0." >&2
      exit 1
    fi
  done
  if tmux has-session -t "=$SENTINEL_SESSION" 2>/dev/null; then
    log "session $SENTINEL_SESSION already running"
  else
    log "starting outage sentinel in tmux session $SENTINEL_SESSION"
    tmux new-session -d -s "$SENTINEL_SESSION" "$SENTINEL_CMD"
  fi
fi

log "${#SESSIONS[@]} loop(s) running: ${SESSIONS[*]}"
log "watch one with: docker exec -it <container> tmux attach -t <session>"

# --- supervise ----------------------------------------------------------------
# Stay up while at least one loop session is alive; report deaths. The tmux
# server exits with its last session, which ends the container.
while :; do
  sleep 30

  # The gateway is on the loops' request path — a dead daemon fails every
  # claude call, so restart it rather than just report it. The reborn gateway
  # may bind a NEW ephemeral port; running claudes read the old one at startup,
  # so once attach settles, respawn every live loop to pick it up.
  if [ "$HYPAWARE" = "1" ] && ! tmux has-session -t '=hyp-daemon' 2>/dev/null; then
    log "WARNING: hypaware daemon exited — restarting (claude routes through its gateway)"
    tmux new-session -d -s hyp-daemon 'hyp daemon run --foreground'
    if port=$(wait_gateway); then
      log "hypaware: gateway back on 127.0.0.1:$port — respawning loops to re-attach"
      for i in "${!SESSIONS[@]}"; do
        if tmux has-session -t "=${SESSIONS[$i]}" 2>/dev/null; then
          tmux kill-session -t "=${SESSIONS[$i]}"
          spawn_loop "${DIRS[$i]}" "${SESSIONS[$i]}" "${CMDS[$i]}"
        fi
      done
    else
      log "WARNING: hypaware gateway still down after daemon restart"
    fi
  fi

  # The watchdog heals the loops; the supervisor heals the watchdog (LLP 0034).
  # Respawn before the aliveness count so a dead watchdog never reads as a
  # dead loop below.
  if [ "$WATCHDOG" = "1" ] && ! tmux has-session -t "=$WATCHDOG_SESSION" 2>/dev/null; then
    log "WARNING: watchdog session exited — respawning"
    spawn_loop /work "$WATCHDOG_SESSION" "$WATCHDOG_CMD"
  fi

  # Dead mayor and dead bridge are the supervisor's, deterministically; a
  # wedged mayor is the watchdog's (LLP 0039 §mutual-coverage). The bridge is
  # inbound-only plumbing — while it is down, the mayor's outbound still flows
  # and its tick polls history for inbound (degraded mode, LLP 0042 R5).
  if [ "$MAYOR" = "1" ]; then
    if ! tmux has-session -t "=$BRIDGE_SESSION" 2>/dev/null; then
      log "WARNING: slack bridge exited — respawning"
      tmux new-session -d -s "$BRIDGE_SESSION" "$BRIDGE_CMD"
    fi
    if ! tmux has-session -t "=$MAYOR_SESSION" 2>/dev/null; then
      log "WARNING: mayor session exited — respawning"
      spawn_loop /work "$MAYOR_SESSION" "$NEUTRAL_MAYOR_CMD"
    fi
  fi

  # A dead sentinel is the supervisor's, deterministically (LLP 0057) — during
  # an outage it is the only voice left, so it must never stay down.
  if [ "$SENTINEL" = "1" ] && ! tmux has-session -t "=$SENTINEL_SESSION" 2>/dev/null; then
    log "WARNING: outage sentinel exited — respawning"
    tmux new-session -d -s "$SENTINEL_SESSION" "$SENTINEL_CMD"
  fi

  alive=0
  for s in "${SESSIONS[@]}"; do
    if tmux has-session -t "=$s" 2>/dev/null; then
      alive=$((alive + 1))
    fi
  done
  # With the watchdog enabled this never fires (it was respawned just above and
  # counts as alive; dead repo loops are its job to resurrect) — teardown is
  # `docker stop`. With NEUTRAL_WATCHDOG=0 the old behavior stands.
  if [ "$alive" -eq 0 ]; then
    log "all loop sessions have exited — stopping container"
    exit 0
  fi
  if [ "$alive" -lt "${#SESSIONS[@]}" ]; then
    for s in "${SESSIONS[@]}"; do
      tmux has-session -t "=$s" 2>/dev/null || log "WARNING: session $s has exited"
    done
  fi
done
