# LLP 0014: Per-repo orchestrator session name; respawn targets the current pane

**Type:** Decision
**Status:** Accepted
**Systems:** Core, Engine
**Author:** Phil
**Date:** 2026-06-26
**Related:** 0002, 0010, 0013

## Context

LLP 0010 §Context recycle fixed the orchestrator's tmux session to a single global
name, `neutral`, and made the self-respawn target it **by name**:

```sh
tmux respawn-pane -k -t neutral "…"
```

`src/commands/start.js` called the name "fixed, not configurable … a different name
would leave the self-respawn unable to find its pane." That coupling has two costs:

- **The mutex is per-machine, not per-repo.** `neutral start` runs
  `tmux new-session -A` (attach-or-create) on the name `neutral`. With one global
  name, running `neutral start` in a *second* repo's directory attaches to the
  *first* repo's loop — the wrong repo. The one-loop-**per-repo** invariant (LLP 0010,
  LLP 0003) is silently downgraded to one-loop-per-machine. You cannot run an
  orchestrator on two repos at once.
- **It conflates the session *name* with the respawn *target*.** The name only had to
  be fixed because the respawn referenced it. But a loop running *inside* its pane
  already knows that pane: tmux exports `$TMUX_PANE`, which `respawn-pane` uses as its
  default target. Targeting the current pane is in fact *more* faithful to "the pane
  is the mutex" than `-t <session>`, which targets that session's *active* pane and
  merely assumes it is the orchestrator.

A rejected alternative — keep one global name and thread a per-repo name from the
launcher into the respawn (an env var the skill reads) — was heavier and kept the two
concerns coupled. Decoupling them removes the constraint instead of routing around it.

## Decision

**1. The session name is per-repo: `neutral-<repo-folder>`** (e.g. `neutral-hypaware`),
derived from the basename of the repo root. So each repo's `neutral start` attaches to
*its own* session and the `-A` attach is a one-orchestrator mutex **per repo**. tmux
treats `.` and `:` as target separators, so `sessionName` collapses any character
outside `[A-Za-z0-9_-]` to `-`; an empty result (e.g. repo `/`) falls back to the bare
`neutral` prefix.

**2. The respawn targets the current pane** — drop `-t`:

```sh
tmux respawn-pane -k "claude '/loop /neutral-reconcile'"
```

tmux defaults to `$TMUX_PANE`, the pane the loop runs in, so the respawn no longer
needs to know the session name. The two concerns are now independent.

The load-bearing parts of LLP 0010 §Context recycle are **unchanged**: the pane is the
one-orchestrator mutex, the respawn is one atomic `respawn-pane -k`, and there is no
cross-boundary handoff (the fresh session re-`observe`s every gap from git/the API,
LLP 0002). This decision refines only *which* pane the respawn names and *how* the
session is named.

## Consequences

- **One-loop-per-repo is now true per repo, not per machine.** Several repos run their
  own orchestrator concurrently; `neutral start` in each binds to that repo's session.
- **The respawn is name-agnostic.** The skill (`neutral-reconcile`) and the spec
  (LLP 0013 §Mechanism) drop `-t neutral`; nothing downstream of the launcher needs to
  know the per-repo name.
- **`neutral start` stays idempotent within a repo** — `-A` on the per-repo name
  attaches to a running loop instead of spawning a second one.
- **Refines LLP 0010 §Context recycle** (the session name is no longer "fixed") and
  keeps LLP 0013's requirements (R4 one-orchestrator, R6 tmux precondition) intact.
- **The name follows the launch directory's basename**, consistent with how the rest
  of the CLI treats `process.cwd()` as the repo root. Two repos with the *same* folder
  name in different paths would still collide — an accepted edge case for the
  prototype, not handled by path-hashing.
