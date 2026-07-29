// @ts-check
// `neutral idle [--json] [--damped a,b]` — the idle-tick autophagy trigger as a single
// ground-truth signal, so the orchestrator ACTS on it rather than re-deciding it (LLP
// 0013/0035/0047). It re-observes all three families (idempotent), classifies idle with
// the pure predicate, reads the session's own measured context size, and selects the
// tick's ONE initiative: `recycle` (idle ∧ ctx > T — respawn the pane, LLP 0010 §Context
// recycle) preempts every repo-hygiene member (LLP 0035 §priority); otherwise the
// least-recently-run member past its cooldown and not no-op damped, or `null` for a
// deliberately idle tick (LLP 0047 §selection).
// @ref LLP 0013#trigger [implements] — recycle iff idle ∧ context-size > T
// @ref LLP 0035#cli-selects [implements] — the CLI selects the initiative
// @ref LLP 0047#selection [implements] — cooldown-gated, least-recently-run repo-hygiene selection
import { run } from '../git.js'
import { loadConfig } from '../config.js'
import { collectBacklog } from './backlog.js'
import { collectImplementable } from '../implementable.js'
import { collectPRs } from './prs.js'
import { collectIssues } from './issues.js'
import { idleState } from '../idle.js'
import { selectInitiative } from '../autophagy.js'
import { listDisposedAutophagyPRs } from '../github.js'
import { readContextSize } from '../context.js'

/**
 * Evaluate the full idle-tick autophagy trigger from ground truth. `contextSize` is null
 * when the session's transcript can't be located (no `$CLAUDE_CODE_SESSION_ID` / not
 * found) — unmeasurable reads as "do not recycle", the safe default (LLP 0002).
 * `selection` reports every repo-hygiene member's eligibility (regardless of idleness);
 * `initiative` folds it all into the one choice (LLP 0035/0047): `recycle` preempts, then
 * the least-recently-run eligible member, then `null`. `damped` carries the orchestrator's
 * per-member no-op scheduling hint (member ids damped at the current target HEAD, LLP
 * 0047 §noop-dampening); `now` is injected for offline testing.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @param {() => (number|null)} [readCtx]
 * @param {{ now?: number, damped?: string[] }} [opts]
 * @returns {Promise<{ idle: boolean, recycle: boolean, initiative: string|null, contextSize: number|null, threshold: number, blockers: import('../types.d.ts').IdleBlocker[], members: import('../types.d.ts').MemberState[] }>}
 */
export async function collectIdle(repo, exec = run, readCtx = readContextSize, { now = Date.now(), damped = [] } = {}) {
  const config = loadConfig(repo)
  const { contextRecycleThreshold: threshold } = config
  const [{ backlog }, implementable, prs, issues, disposed] = await Promise.all([
    collectBacklog(repo),
    collectImplementable(repo, exec),
    collectPRs(repo, exec),
    collectIssues(repo, exec),
    listDisposedAutophagyPRs(repo, exec)
  ])
  const { idle, blockers } = idleState({ backlog, implementable, prs, issues })
  const contextSize = readCtx()
  const recycle = idle && contextSize !== null && contextSize > threshold
  const { initiative: member, members } = selectInitiative({ openPRs: prs, disposed, config, now, damped })
  // @ref LLP 0035#priority [implements] — recycle preempts repo hygiene
  // @ref LLP 0047#selection [implements] — else the LRR member, else null
  const initiative = recycle ? 'recycle' : (idle ? member : null)
  return { idle, recycle, initiative, contextSize, threshold, blockers, members }
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @param {() => (number|null)} [readCtx]
 * @returns {Promise<number>}
 */
export async function idleCommand(repo, args, exec = run, readCtx = readContextSize) {
  // The orchestrator passes its session no-op hint as `--damped id,id` (LLP 0047): members
  // that scanned the current target HEAD and found nothing. A scheduling hint, not a fact.
  const dampedArg = args[args.indexOf('--damped') + 1]
  const damped = args.includes('--damped') && dampedArg ? dampedArg.split(',').map(s => s.trim()).filter(Boolean) : []
  const s = await collectIdle(repo, exec, readCtx, { damped })
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(s, null, 2) + '\n')
  } else {
    const ctx = s.contextSize === null ? 'unmeasured' : `${s.contextSize} tok`
    process.stdout.write(`idle=${s.idle} initiative=${s.initiative ?? 'none'} context=${ctx} (T=${s.threshold})\n`)
    if (!s.idle) {
      for (const b of s.blockers) process.stdout.write(`  blocker: ${b.family} ${b.target} — ${b.reason}\n`)
    } else if (s.initiative !== 'recycle') {
      for (const m of s.members) process.stdout.write(`  ${m.id}: ${m.eligible ? 'eligible' : 'ineligible'} — ${m.reason}\n`)
    }
  }
  return 0
}
