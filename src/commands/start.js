// @ts-check
// `neutral start` — launch the one orchestrator inside the tmux pane context autophagy
// needs (LLP 0013 / LLP 0010 §Context recycle), so a human types one command instead of
// the raw `tmux new-session …` incantation. A launcher CONTROLLER: like git.js/github.js
// it shells out (here to tmux); the pure part — the argv it builds — is unit-tested. The
// session is named `neutral-<repo-folder>` so several repos run their own orchestrator on
// one machine without colliding on a single global `neutral` session (LLP 0014).
// @ref LLP 0010#context-recycle [constrained-by] — the pane (not the name) is the mutex
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { run } from '../git.js'

// Fallback session name and per-repo prefix. The live name is per-repo (`sessionName`);
// this bare form is used only when the repo folder sanitizes to empty (e.g. repo === '/').
export const ORCHESTRATOR_SESSION = 'neutral'
// The orchestrator runs on the WORKER tier (LLP 0020): the tick is deliberately
// mechanical — the CLI decides every rung, fan-in is git commands — so it does not
// need the judgment tier, and it is the single largest spend. Pinned explicitly so a
// respawn (LLP 0013) or a machine with a different session default can't silently
// revert it. `opus` = Opus 4.8; prefer its 1M-context variant so the loop's context can
// grow to the autophagy threshold T (LLP 0013) before recycling.
// @ref LLP 0020#decision [implements] — orchestrator = worker tier, pinned at launch
export const ORCHESTRATOR_MODEL = 'opus'
// The loop, as one shell-command string tmux runs via `sh -c`.
export const LOOP_SHELL_COMMAND = `claude --model ${ORCHESTRATOR_MODEL} '/loop /neutral-reconcile'`

/**
 * The orchestrator's tmux session name for a repo: `neutral-<repo-folder>` (e.g.
 * `neutral-hypaware`). Per-repo so the `-A` attach binds one orchestrator PER REPO rather
 * than one per machine — without this, `neutral start` in a second repo would attach to
 * the first repo's loop. tmux treats `.` and `:` as target separators, so any char outside
 * `[A-Za-z0-9_-]` collapses to `-`; an empty result falls back to the bare prefix.
 * @param {string} repo  the repo root (cwd)
 * @returns {string}
 * @ref LLP 0014#decision [implements] — per-repo session name
 */
export function sessionName(repo) {
  const folder = basename(String(repo || '')).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return folder ? `${ORCHESTRATOR_SESSION}-${folder}` : ORCHESTRATOR_SESSION
}

/**
 * The `tmux new-session` argv that starts (or, with `-A`, re-attaches to) the
 * orchestrator. `-A` makes the launch idempotent — a second `neutral start` attaches to
 * the running loop instead of spawning a second orchestrator. `-d` (nested case) creates
 * it detached, because attaching from inside an existing tmux client would nest panes.
 * @param {{ nested?: boolean, session?: string, command?: string }} [opts]
 * @returns {string[]}
 */
export function tmuxStartArgv({ nested = false, session = ORCHESTRATOR_SESSION, command = LOOP_SHELL_COMMAND } = {}) {
  const flags = nested ? ['-d', '-A'] : ['-A']
  return ['new-session', ...flags, '-s', session, command]
}

/**
 * Launch the orchestrator in its tmux pane. tmux missing → print the bare-`claude`
 * fallback (R6: the loop still runs, just without self-respawn) and fail. Inside tmux
 * already → ensure the session exists detached and tell the user how to switch to it.
 * Otherwise hand the terminal to tmux interactively (attach or create-and-attach).
 * @param {string} repo
 * @param {string[]} _args
 * @param {{ exec?: typeof run, spawn?: (cmd: string, args: string[]) => { status: number|null }, env?: NodeJS.ProcessEnv }} [deps]
 * @returns {Promise<number>}
 */
export async function startCommand(repo, _args, deps = {}) {
  const exec = deps.exec || run
  const spawn = deps.spawn || ((cmd, a) => spawnSync(cmd, a, { stdio: 'inherit' }))
  const env = deps.env || process.env

  try {
    await exec('tmux', ['-V'], process.cwd())
  } catch {
    process.stderr.write(
      'neutral start: tmux not found — context autophagy needs a tmux pane (LLP 0013).\n' +
      'Install tmux, or run the loop without self-respawn (falls back to summarization):\n' +
      `  claude "/loop /neutral-reconcile"\n`
    )
    return 1
  }

  const nested = !!env.TMUX
  const session = sessionName(repo)
  const argv = tmuxStartArgv({ nested, session })

  if (nested) {
    // Can't attach from inside tmux without nesting panes — just ensure it's running.
    await exec('tmux', argv, process.cwd())
    process.stdout.write(
      `neutral: orchestrator session '${session}' is running.\n` +
      `Switch to it with:  tmux switch-client -t ${session}\n`
    )
    return 0
  }

  const res = spawn('tmux', argv)
  return res && typeof res.status === 'number' ? res.status : 0
}
