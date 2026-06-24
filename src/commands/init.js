// @ts-check
// `neutral init` — onboard a repo: scaffold `.neutral/config.json` + an empty
// baseline, then report what neutral WOULD drive, so a brownfield repo (existing
// code, maybe existing LLPs, no design layer) starts from a correct backlog.
// @ref LLP 0007#neutral-init
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../config.js'
import { observe } from '../state.js'
import { inFlightCoveredRefs } from '../inflight.js'
import { loadBaseline } from '../baseline.js'
import { padStart } from '../format.js'

/**
 * @param {string} repo
 * @param {string[]} _args
 * @returns {Promise<number>}
 */
export async function initCommand(repo, _args) {
  const dir = join(repo, '.neutral')
  mkdirSync(dir, { recursive: true })
  const cfgPath = join(dir, 'config.json')
  const basePath = join(dir, 'baseline.json')
  const wroteCfg = ensure(cfgPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')
  const wroteBase = ensure(basePath, JSON.stringify({ grandfathered: [] }, null, 2) + '\n')

  const world = observe(repo)
  const inFlight = await inFlightCoveredRefs(repo, undefined, world.config)
  const baseline = loadBaseline(repo)
  const backlog = world.coverage.uncovered.filter(l => !inFlight.has(l.number) && !baseline.has(l.number))

  /** @type {string[]} */
  const out = []
  out.push(`neutral init — ${repo}`)
  out.push(`  config:   .neutral/config.json   ${wroteCfg ? '(created)' : '(exists, kept)'}`)
  out.push(`  baseline: .neutral/baseline.json ${wroteBase ? '(created)' : '(exists, kept)'}`)
  out.push(`  llpDir:   ${world.config.llpDir}/`)
  out.push(`  requests: ${world.coverage.eligible.length} live · covered ${world.coverage.covered.length} · in-flight ${inFlight.size} · baselined ${baseline.size}`)
  out.push('')
  if (!backlog.length) {
    out.push('  backlog: empty — neutral would drive nothing new. Safe to start the loop.')
  } else {
    out.push(`  backlog: ${backlog.length} request(s) neutral WOULD design + build:`)
    for (const l of backlog) out.push(`    ${padStart(String(l.number), 4, '0')}  ${l.title}  [${l.type}]`)
    out.push('')
    out.push('  Review it. For any request that is ALREADY implemented, either:')
    out.push('    • add `@ref LLP NNNN [implements]` to the realizing code (preferred — real, checkable coverage), or')
    out.push('    • grandfather it in .neutral/baseline.json: { "grandfathered": [{ "llp": NNNN, "reason": "..." }] }')
    out.push('  Re-run `neutral init` (or `neutral backlog`) until the backlog is exactly the new work you want driven.')
    out.push('  (For an agent-assisted survey that finds + annotates already-built requests, run the /neutral-init skill.)')
  }
  out.push('')
  out.push('  Make sure these are TRACKED (not gitignored): .neutral/config.json, .neutral/baseline.json')
  process.stdout.write(out.join('\n') + '\n')
  return backlog.length ? 1 : 0
}

/**
 * @param {string} path
 * @param {string} content
 * @returns {boolean}  true if written (did not already exist)
 */
function ensure(path, content) {
  if (existsSync(path)) return false
  writeFileSync(path, content)
  return true
}
