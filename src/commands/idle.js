// @ts-check
// `neutral idle [--json]` — the idle-tick autophagy trigger as a single ground-truth
// signal, so the orchestrator ACTS on it rather than re-deciding it (LLP 0013/0035). It
// re-observes all three families (idempotent), classifies idle with the pure predicate,
// reads the session's own measured context size, and selects the tick's ONE initiative
// (LLP 0035): `recycle` (idle ∧ ctx > T — respawn the pane instead of scheduling,
// LLP 0010 §Context recycle) preempts `cleanup` (idle ∧ the code-cleanup member is
// eligible, LLP 0036); `null` means the tick ends normally.
// @ref LLP 0013#trigger [implements] — recycle iff idle ∧ context-size > T
// @ref LLP 0035#cli-selects [implements] — the CLI selects the initiative
import { run } from '../git.js'
import { loadConfig } from '../config.js'
import { collectBacklog } from './backlog.js'
import { collectImplementable } from '../implementable.js'
import { collectPRs } from './prs.js'
import { collectIssues } from './issues.js'
import { idleState } from '../idle.js'
import { cleanupState } from '../autophagy.js'
import { readContextSize } from '../context.js'

/**
 * Evaluate the full idle-tick autophagy trigger from ground truth. `contextSize` is null
 * when the session's transcript can't be located (no `$CLAUDE_CODE_SESSION_ID` / not
 * found) — unmeasurable reads as "do not recycle", the safe default (LLP 0002).
 * `cleanup` reports the code-cleanup member's eligibility regardless of idleness;
 * `initiative` folds it all into the one selection (LLP 0035): runtime before repo
 * hygiene, at most one per tick.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @param {() => (number|null)} [readCtx]
 * @returns {Promise<{ idle: boolean, recycle: boolean, initiative: 'recycle'|'cleanup'|null, contextSize: number|null, threshold: number, blockers: import('../types.d.ts').IdleBlocker[], cleanup: import('../types.d.ts').CleanupState }>}
 */
export async function collectIdle(repo, exec = run, readCtx = readContextSize) {
  const config = loadConfig(repo)
  const { contextRecycleThreshold: threshold } = config
  const [{ backlog }, implementable, prs, issues] = await Promise.all([
    collectBacklog(repo),
    collectImplementable(repo, exec),
    collectPRs(repo, exec),
    collectIssues(repo, exec)
  ])
  const { idle, blockers } = idleState({ backlog, implementable, prs, issues })
  const contextSize = readCtx()
  const recycle = idle && contextSize !== null && contextSize > threshold
  const cleanup = cleanupState(prs, config)
  // @ref LLP 0035#priority [implements] — recycle preempts cleanup
  const initiative = recycle ? 'recycle' : (idle && cleanup.eligible ? 'cleanup' : null)
  return { idle, recycle, initiative, contextSize, threshold, blockers, cleanup }
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @param {() => (number|null)} [readCtx]
 * @returns {Promise<number>}
 */
export async function idleCommand(repo, args, exec = run, readCtx = readContextSize) {
  const s = await collectIdle(repo, exec, readCtx)
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n')
  } else {
    const ctx = s.contextSize === null ? 'unmeasured' : `${s.contextSize} tok`
    process.stdout.write(`idle=${s.idle} initiative=${s.initiative ?? 'none'} context=${ctx} (T=${s.threshold})\n`)
    if (!s.idle) {
      for (const b of s.blockers) process.stdout.write(`  blocker: ${b.family} ${b.target} — ${b.reason}\n`)
    } else if (s.initiative !== 'recycle') {
      process.stdout.write(`  cleanup: ${s.cleanup.eligible ? 'eligible' : 'ineligible'} — ${s.cleanup.reason}\n`)
    }
  }
  return 0
}
