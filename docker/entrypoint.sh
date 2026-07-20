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

MODEL="${NEUTRAL_MODEL:-claude-opus-4-8[1m]}"
CLAUDE_ARGS="${NEUTRAL_CLAUDE_ARGS:---dangerously-skip-permissions}"
# Model single-quoted so sh doesn't glob the [1m] brackets (see LOOP_SHELL_COMMAND).
LOOP_CMD="claude --model '$MODEL' $CLAUDE_ARGS '/loop /neutral-reconcile'"

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

spawn_loop() { # $1 = repo dir, $2 = session name
  tmux new-session -d -s "$2" -c "$1" "$LOOP_CMD"
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
  else
    log "hypaware: no HYP_REMOTE_URL/HYP_REMOTE_TOKEN — capturing locally only, no central sync"
  fi

  tmux new-session -d -s hyp-daemon 'hyp daemon run --foreground'

  if port=$(wait_gateway); then
    log "hypaware: gateway up on 127.0.0.1:$port"
  else
    log "WARNING: hypaware gateway did not come up — loops may fail until it does"
  fi
fi

# --- clone + launch, one session per repo (LLP 0014) --------------------------

SESSIONS=()
DIRS=()
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
  if tmux has-session -t "=$session" 2>/dev/null; then
    log "session $session already running"
  else
    log "starting loop for $repo in tmux session $session"
    spawn_loop "$dir" "$session"
  fi
done

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
          spawn_loop "${DIRS[$i]}" "${SESSIONS[$i]}"
        fi
      done
    else
      log "WARNING: hypaware gateway still down after daemon restart"
    fi
  fi

  alive=0
  for s in "${SESSIONS[@]}"; do
    if tmux has-session -t "=$s" 2>/dev/null; then
      alive=$((alive + 1))
    fi
  done
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
