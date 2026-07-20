# syntax=docker/dockerfile:1
# Container that runs neutral reconcile loop(s) — one tmux session per target repo,
# each running `claude '/loop /neutral-reconcile'` (mirrors src/commands/start.js).
#
# Build:
#   docker build -t neutral-loop --build-arg NEUTRAL_REPOS="owner/repo-a owner/repo-b" .
# Run:
#   docker run -d --name neutral-loop --hostname neutral-loops \
#     -e GH_TOKEN=... \
#     -e CLAUDE_CODE_OAUTH_TOKEN=... \   # or ANTHROPIC_API_KEY=...
#     -e HYP_REMOTE_URL=https://hypaware.example.app \
#     -e HYP_REMOTE_TOKEN=... \          # omit both HYP_* for local-only capture
#     -v neutral-work:/work -v neutral-hyp:/home/neutral/.hyp \
#     neutral-loop
#
# NEUTRAL_REPOS is baked as a default by the build arg but can be overridden at
# runtime with -e NEUTRAL_REPOS="...". Repos are cloned by the entrypoint at
# container start (never at build time, so no credentials land in image layers).

FROM node:22-bookworm-slim

# git + gh are the loop's ground-truth controllers; tmux is required for context
# autophagy (the pane is the respawn mutex — LLP 0013).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git tmux curl ca-certificates jq procps \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# hypaware records each loop's Claude traffic (gateway + transcripts) into a
# local cache and, when a remote token is provided, forwards it to the central
# HypAware server.
RUN npm install -g @anthropic-ai/claude-code hypaware

# Non-root user: the headless loop runs with --dangerously-skip-permissions,
# which Claude Code refuses to run as root.
RUN useradd -m -s /bin/bash neutral \
  && mkdir -p /work \
  && chown neutral:neutral /work

# neutral itself — the deterministic CLI has no runtime deps, so a symlink is
# the whole install.
COPY --chown=neutral:neutral . /opt/neutral
RUN ln -s /opt/neutral/bin/neutral.js /usr/local/bin/neutral

USER neutral

# Expose neutral's skills user-level so /neutral-reconcile resolves inside any
# target repo (same shape as a ~/.claude/skills symlink on a dev machine).
RUN mkdir -p /home/neutral/.claude/skills \
  && ln -s /opt/neutral/.claude/skills/neutral-reconcile /home/neutral/.claude/skills/neutral-reconcile \
  && ln -s /opt/neutral/.claude/skills/neutral-init /home/neutral/.claude/skills/neutral-init

# Pre-seed Claude Code's user config so a headless first run never stops at
# interactive onboarding (theme picker / bypass-permissions confirmation).
# Per-repo trust is added by the entrypoint once the clone paths are known.
RUN printf '{"hasCompletedOnboarding": true, "theme": "dark", "bypassPermissionsModeAccepted": true}\n' \
      > /home/neutral/.claude.json

# Pre-create the HYP_HOME mount point so a named volume mounted here inherits
# neutral's ownership instead of being created root-owned by the engine.
RUN mkdir -p /home/neutral/.hyp

# Space- or comma-separated list of GitHub repos (owner/name) to run loops for.
ARG NEUTRAL_REPOS=""
ENV NEUTRAL_REPOS=$NEUTRAL_REPOS

# Overridable knobs (defaults mirror src/commands/start.js).
ENV NEUTRAL_MODEL="claude-opus-4-8[1m]"
ENV NEUTRAL_CLAUDE_ARGS="--dangerously-skip-permissions"

# HypAware capture. On by default (local cache only); central sync activates
# when both HYP_REMOTE_URL and HYP_REMOTE_TOKEN are set at run time. Forwarded
# rows are labeled with the container hostname — pass a stable, meaningful one
# (docker run --hostname neutral-loops). Set NEUTRAL_HYPAWARE=0 to disable
# capture entirely. Mount a volume at /home/neutral/.hyp to keep unsynced
# capture across container recreation.
ENV NEUTRAL_HYPAWARE="1"
ENV HYP_REMOTE_NAME="prod"
ENV HYP_REMOTE_URL=""

WORKDIR /work
ENTRYPOINT ["/opt/neutral/docker/entrypoint.sh"]
