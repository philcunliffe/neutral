// @ts-check
// `neutral implementable [--json]` — design-first intake: designs merged to the target
// branch at Status: Accepted with no integration branch yet, i.e. approved designs owed
// an implementation (the Designer step was done by hand). The pipeline-family observe
// surface for design-first work, shared with the idle predicate. Exit 1 when work
// remains, 0 when empty (mirrors `neutral backlog`).
// @ref LLP 0016#intake [implements]
import { run } from '../git.js'
import { collectImplementable } from '../implementable.js'
import { padStart } from '../format.js'

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @returns {Promise<number>}
 */
export async function implementableCommand(repo, args, exec = run) {
  const items = await collectImplementable(repo, exec)
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(items, null, 2) + '\n')
  } else if (!items.length) {
    process.stdout.write('implementable: none (no Accepted design on target awaiting implementation)\n')
  } else {
    process.stdout.write(
      `implementable: ${items.length} Accepted design(s) awaiting implementation:\n` +
      items.map(d => `  ${padStart(String(d.number), 4, '0')}  ${d.slug}  ${d.title}`).join('\n') + '\n'
    )
  }
  return items.length ? 1 : 0
}
