// @ts-check
// `neutral backlog [--json]` — the Designer's authoritative input: live requests
// covered by neither a merged design, code, nor an in-flight integration branch.
// Exit 0 when empty, 1 when work remains.
// @ref LLP 0003#coverage-invariant
import { observe } from '../state.js'
import { inFlightCoveredRefs } from '../inflight.js'
import { padStart } from '../format.js'

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function backlogCommand(repo, args) {
  const world = observe(repo)
  const inFlight = await inFlightCoveredRefs(repo)
  const backlog = world.coverage.uncovered.filter(l => !inFlight.has(l.number))

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ backlog, inFlight: [...inFlight] }, null, 2) + '\n')
  } else if (!backlog.length) {
    process.stdout.write(`backlog: empty (${world.coverage.eligible.length} request(s); ${inFlight.size} covered in-flight)\n`)
  } else {
    process.stdout.write(
      `backlog: ${backlog.length} request(s) need a design (excluding ${inFlight.size} in-flight):\n` +
      backlog.map(l => `  ${padStart(String(l.number), 4, '0')}  ${l.title}  [${l.type}]`).join('\n') + '\n'
    )
  }
  return backlog.length ? 1 : 0
}
