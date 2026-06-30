// @ts-check
// `neutral coverage [--json]` — the Designer backlog as an exit code: 0 when every
// live request is covered, 1 when any is uncovered. The loop/CI gate.
// @ref LLP 0003#coverage-invariant
import { observe } from '../state.js'
import { padStart } from '../format.js'

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function coverageCommand(repo, args) {
  const { coverage } = await observe(repo)
  const n = coverage.uncovered.length

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(coverage, null, 2) + '\n')
  } else if (n === 0) {
    process.stdout.write(`coverage: ok — ${coverage.eligible.length} request(s) covered\n`)
  } else {
    process.stdout.write(
      `coverage: ${n}/${coverage.eligible.length} request(s) uncovered:\n` +
      coverage.uncovered.map(l => `  ${padStart(String(l.number), 4, '0')}  ${l.title}  [${l.type}]`).join('\n') +
      '\n'
    )
  }
  return n === 0 ? 0 : 1
}
