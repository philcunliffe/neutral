// @ts-check
// `neutral idle [--json]` — the context-autophagy trigger as a single ground-truth
// signal, so the orchestrator ACTS on it rather than re-deciding it (LLP 0013). It
// re-observes all three families (idempotent), classifies idle with the pure predicate,
// reads the session's own measured context size, and reports `recycle = idle ∧ ctx > T`.
// On `recycle: true` the reconcile tick respawns its pane instead of scheduling the next
// tick (LLP 0010 §Context recycle); otherwise the tick ends normally.
// @ref LLP 0013#trigger [implements] — recycle iff idle ∧ context-size > T
import { run } from '../git.js'
import { loadConfig } from '../config.js'
import { collectBacklog } from './backlog.js'
import { collectPRs } from './prs.js'
import { collectIssues } from './issues.js'
import { idleState } from '../idle.js'
import { readContextSize } from '../context.js'

/**
 * Evaluate the full context-autophagy trigger from ground truth. `contextSize` is null
 * when the session's transcript can't be located (no `$CLAUDE_CODE_SESSION_ID` / not
 * found) — unmeasurable reads as "do not recycle", the safe default (LLP 0002).
 * @param {string} repo
 * @param {typeof run} [exec]
 * @param {() => (number|null)} [readCtx]
 * @returns {Promise<{ idle: boolean, recycle: boolean, contextSize: number|null, threshold: number, blockers: import('../types.d.ts').IdleBlocker[] }>}
 */
export async function collectIdle(repo, exec = run, readCtx = readContextSize) {
  const { contextRecycleThreshold: threshold } = loadConfig(repo)
  const [{ backlog }, prs, issues] = await Promise.all([
    collectBacklog(repo),
    collectPRs(repo, exec),
    collectIssues(repo, exec)
  ])
  const { idle, blockers } = idleState({ backlog, prs, issues })
  const contextSize = readCtx()
  const recycle = idle && contextSize !== null && contextSize > threshold
  return { idle, recycle, contextSize, threshold, blockers }
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
    process.stdout.write(`idle=${s.idle} recycle=${s.recycle} context=${ctx} (T=${s.threshold})\n`)
    if (!s.idle) {
      for (const b of s.blockers) process.stdout.write(`  blocker: ${b.family} ${b.target} — ${b.reason}\n`)
    }
  }
  return 0
}
