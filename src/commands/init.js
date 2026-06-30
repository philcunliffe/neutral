// @ts-check
// `neutral init` — onboard a repo: scaffold `.neutral/config.json` + an empty
// baseline, then report what neutral WOULD drive, so a brownfield repo (existing
// code, maybe existing LLPs, no design layer) starts from a correct backlog.
// @ref LLP 0007#neutral-init
import { mkdirSync, writeFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../config.js'
import { observe } from '../state.js'
import { inFlightCoveredRefs } from '../inflight.js'
import { loadBaseline } from '../baseline.js'
import { padStart } from '../format.js'

// Markers delimiting the managed convention block, so a re-run is idempotent and a
// human can see the block is `neutral init`'s to own. Same HTML-comment idiom as the
// PR-body review marker.
export const CONVENTION_MARKER = '<!-- neutral:llp-conventions -->'
export const CONVENTION_END = '<!-- /neutral:llp-conventions -->'

// The LLP-immutability rule, seeded into the target repo's CLAUDE.md so the dual
// review — which checks the repo's CLAUDE.md conventions — catches a PR that edits an
// Accepted LLP's decided content. Review-enforced, no new engine code.
// @ref LLP 0015#enforcement--seeded-convention-review-checked [implements]
export function conventionBlock() {
  return [
    CONVENTION_MARKER,
    '## LLP conventions',
    '',
    'Design rationale lives in numbered **LLP** documents under `llp/`, driven by neutral.',
    '',
    '- **Immutable docs; change is a new request.** An Accepted/Active LLP is a',
    '  *record*, not a worksheet — do not edit what it decided or required. To change',
    '  intent, mint a **new request** (`rfc`/`spec`/`issue`) that `@ref`s what it',
    '  supersedes, and append a `Superseded-by:`/`Extended-by: LLP NNNN` forward-ref to',
    '  the applicable parts of the old doc. Trivial editorial fixes (typos, links,',
    '  forward-refs) are fine; Drafts are still editable.',
    CONVENTION_END
  ].join('\n')
}

/**
 * Idempotent merge of the convention block into an existing CLAUDE.md body (or a new
 * one). Returns the full new body, or `null` when the block is already present (no
 * write needed). Pure — the fs half is `seedConvention`. @ref LLP 0002 — re-derivable
 * @param {string | null} existing  current CLAUDE.md body, or null if absent
 * @returns {string | null}
 */
export function withConventionBlock(existing) {
  const body = existing || ''
  if (body.includes(CONVENTION_MARKER)) return null
  const block = conventionBlock()
  return body.trim() ? body.replace(/\n*$/, '') + '\n\n' + block + '\n' : block + '\n'
}

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
  const convention = seedConvention(repo)

  const world = await observe(repo)
  const inFlight = await inFlightCoveredRefs(repo, undefined, world.config)
  const baseline = loadBaseline(repo)
  const backlog = world.coverage.uncovered.filter(l => !inFlight.has(l.number) && !baseline.has(l.number))

  /** @type {string[]} */
  const out = []
  out.push(`neutral init — ${repo}`)
  out.push(`  config:   .neutral/config.json   ${wroteCfg ? '(created)' : '(exists, kept)'}`)
  out.push(`  baseline: .neutral/baseline.json ${wroteBase ? '(created)' : '(exists, kept)'}`)
  out.push(`  CLAUDE.md: LLP-immutability convention ${convention} (review-enforced)`)
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

/**
 * Ensure the repo's `CLAUDE.md` carries the LLP-immutability convention block. Resolves
 * the symlink first (a repo may keep its real guidance in `AGENTS.md` with `CLAUDE.md`
 * pointing at it), creates the file when absent, and is idempotent on re-run.
 * @param {string} repo
 * @returns {'(created)' | '(appended)' | '(kept)'}
 */
function seedConvention(repo) {
  const claude = join(repo, 'CLAUDE.md')
  const present = existsSync(claude)
  const target = present ? realpathSync(claude) : claude
  const existing = present ? readFileSync(target, 'utf8') : null
  const next = withConventionBlock(existing)
  if (next === null) return '(kept)'
  writeFileSync(target, next)
  return present ? '(appended)' : '(created)'
}
