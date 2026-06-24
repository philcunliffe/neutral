// @ts-check
// `neutral llp <number> [--json]` — inspect a single LLP: its metadata, its
// pipeline role (request | design | background), and its coverage. Read-only and
// purely additive — reuses the engine, mutates nothing.
// @ref LLP 0004 [implements] — the read-only single-LLP inspection command
// @ref LLP 0005 [implements] — the design this realizes
import { readLlps, isRequestType, isDesignType, isLive } from '../llp.js'
import { readCodeRefs } from '../refs.js'
import { padStart } from '../format.js'

/** @import { Llp } from '../types.d.ts' */

/**
 * The pipeline role an LLP plays, derived from its `type`.
 * @param {Llp} llp
 * @returns {'request' | 'design' | 'background'}
 */
export function llpRole(llp) {
  if (isRequestType(llp)) return 'request'
  if (isDesignType(llp)) return 'design'
  return 'background'
}

/**
 * Render the human-readable report for one resolved LLP.
 * @param {Llp} llp
 * @param {Llp[]} llps  the full corpus (for a request's coverage)
 * @param {Set<number>} codeRefs  LLP numbers realized in code
 * @returns {string}
 */
export function llpReport(llp, llps, codeRefs) {
  const role = llpRole(llp)
  /** @type {string[]} */
  const out = []
  out.push(`LLP ${padStart(String(llp.number), 4, '0')}  ${llp.title}`)
  out.push(`  type     ${llp.type} (${role})`)
  out.push(`  status   ${llp.status}`)
  out.push(`  systems  ${llp.systems.length ? llp.systems.join(', ') : '(none)'}`)
  out.push(`  author   ${llp.author || '(unknown)'}`)
  out.push(`  date     ${llp.date || '(unknown)'}`)
  out.push(`  path     ${llp.path}`)

  if (role === 'design') {
    // "covers" is about the requests this design realizes — not every @ref it
    // makes (a plan @ref's its design too). Filter to request-type LLPs.
    const requestNums = new Set(llps.filter(isRequestType).map(l => l.number))
    const covers = llp.refs.filter(n => requestNums.has(n))
    out.push(`  covers   ${covers.length ? covers.map(n => padStart(String(n), 4, '0')).join(' ') : '(none)'}`)
  } else if (role === 'request') {
    const by = coveredBy(llp, llps, codeRefs)
    if (by.length) out.push(`  covered  by ${by.join(' ')}`)
    else if (isLive(llp)) out.push('  covered  no — uncovered (needs a design)')
    else out.push(`  covered  not required (status ${llp.status})`)
  }

  return out.join('\n') + '\n'
}

/**
 * The design ids and/or `'code'` covering a request LLP, computed directly from
 * the corpus so it is correct regardless of the request's liveness (the gated
 * `coverage()` would omit a Draft request entirely and misreport it).
 * @param {Llp} llp
 * @param {Llp[]} llps
 * @param {Set<number>} codeRefs
 * @returns {string[]}
 */
function coveredBy(llp, llps, codeRefs) {
  const by = llps
    .filter(isDesignType)
    .filter(d => d.refs.includes(llp.number))
    .map(d => padStart(String(d.number), 4, '0'))
  if (codeRefs.has(llp.number)) by.push('code')
  return by
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {number}
 */
export function llpCommand(repo, args) {
  const json = args.includes('--json')
  const raw = args.find(a => !a.startsWith('--'))
  const number = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN
  if (Number.isNaN(number)) {
    process.stderr.write('usage: neutral llp <number> [--json]\n')
    return 2
  }

  const llps = readLlps(repo)
  const llp = llps.find(l => l.number === number)
  if (!llp) {
    process.stderr.write(`neutral: no LLP with number ${padStart(String(number), 4, '0')}\n`)
    return 2
  }

  if (json) {
    const codeRefs = readCodeRefs(repo)
    const role = llpRole(llp)
    const by = role === 'request' ? coveredBy(llp, llps, codeRefs) : undefined
    process.stdout.write(JSON.stringify({ ...llp, role, coveredBy: by }, null, 2) + '\n')
    return 0
  }

  const codeRefs = readCodeRefs(repo)
  process.stdout.write(llpReport(llp, llps, codeRefs))
  return 0
}
