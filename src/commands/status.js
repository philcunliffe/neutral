// @ts-check
// `neutral status [--json]` — the loop's eyes: corpus by stage, coverage gap, designs.
import { observe } from '../state.js'
import { padStart } from '../format.js'

/** @import { World, Llp } from '../types.d.ts' */

const STATUS_ORDER = ['Draft', 'Review', 'Accepted', 'Active', 'Superseded', 'Tombstoned']

/**
 * @param {string} status
 * @returns {number}
 */
function statusRank(status) {
  const i = STATUS_ORDER.findIndex(s => s.toLowerCase() === status.toLowerCase())
  return i < 0 ? STATUS_ORDER.length : i
}

/**
 * @param {number} n
 * @returns {string}
 */
function pad4(n) {
  return padStart(String(n), 4, '0')
}

/**
 * @param {Llp} l
 * @returns {string}
 */
function llpLine(l) {
  return `    ${pad4(l.number)}  ${l.title}  [${l.type}]`
}

/**
 * @param {World} world
 * @returns {string}
 */
export function statusReport(world) {
  /** @type {string[]} */
  const out = []

  out.push('LLP corpus')
  /** @type {Map<string, Llp[]>} */
  const byStatus = new Map()
  for (const l of world.llps) {
    const arr = byStatus.get(l.status)
    if (arr) arr.push(l)
    else byStatus.set(l.status, [l])
  }
  if (!world.llps.length) out.push('  (empty)')
  for (const status of [...byStatus.keys()].sort((a, b) => statusRank(a) - statusRank(b))) {
    out.push(`  ${status.toUpperCase()}`)
    for (const l of byStatus.get(status) || []) out.push(llpLine(l))
  }

  out.push('')
  out.push('Coverage  (Designer backlog)')
  const { eligible, uncovered } = world.coverage
  if (!eligible.length) {
    out.push('  (no out-of-draft requests yet)')
  } else if (!uncovered.length) {
    out.push(`  ok — all ${eligible.length} out-of-draft request(s) covered by a design or code`)
  } else {
    out.push(`  ${uncovered.length}/${eligible.length} request(s) uncovered — need a design:`)
    for (const l of uncovered) out.push(llpLine(l))
  }

  out.push('')
  out.push('Designs')
  const { designs } = world.coverage
  if (!designs.length) {
    out.push('  (none)')
  } else {
    for (const d of designs) {
      const covers = d.refs.length ? d.refs.map(pad4).join(' ') : '(none)'
      out.push(`  ${pad4(d.number)}  ${d.title}  [${d.type}]  covers ${covers}`)
    }
  }

  out.push('')
  return out.join('\n')
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function statusCommand(repo, args) {
  const world = await observe(repo)
  if (args.includes('--json')) process.stdout.write(JSON.stringify(world, null, 2) + '\n')
  else process.stdout.write(statusReport(world))
  return 0
}
