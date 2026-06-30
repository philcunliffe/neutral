// @ts-check
// `neutral backlog [--json]` — the Designer's authoritative input: live requests
// covered by neither a merged design, code, an in-flight integration branch, nor
// the adoption baseline. Exit 0 when empty, 1 when work remains.
// @ref LLP 0003#coverage-invariant
import { observe } from '../state.js'
import { inFlightCoveredRefs } from '../inflight.js'
import { loadBaseline } from '../baseline.js'
import { padStart } from '../format.js'

/** @import { Llp } from '../types.d.ts' */

/**
 * The Designer backlog: live requests covered by neither a merged design, code, an
 * in-flight integration branch, nor the adoption baseline. The pipeline family's
 * observe surface, shared by `neutral backlog` and the idle predicate (`neutral idle`).
 * @param {string} repo
 * @returns {Promise<{ backlog: Llp[], inFlight: Set<number>, baseline: Set<number>, eligible: number }>}
 */
export async function collectBacklog(repo) {
  const world = await observe(repo)
  const inFlight = await inFlightCoveredRefs(repo, undefined, world.config)
  const baseline = loadBaseline(repo)
  const backlog = world.coverage.uncovered.filter(l => !inFlight.has(l.number) && !baseline.has(l.number))
  return { backlog, inFlight, baseline, eligible: world.coverage.eligible.length }
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function backlogCommand(repo, args) {
  const { backlog, inFlight, baseline, eligible } = await collectBacklog(repo)

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ backlog, inFlight: [...inFlight], baselined: [...baseline] }, null, 2) + '\n')
  } else if (!backlog.length) {
    process.stdout.write(`backlog: empty (${eligible} request(s); ${inFlight.size} in-flight, ${baseline.size} baselined)\n`)
  } else {
    process.stdout.write(
      `backlog: ${backlog.length} request(s) need a design (excluding ${inFlight.size} in-flight, ${baseline.size} baselined):\n` +
      backlog.map(l => `  ${padStart(String(l.number), 4, '0')}  ${l.title}  [${l.type}]`).join('\n') + '\n'
    )
  }
  return backlog.length ? 1 : 0
}
