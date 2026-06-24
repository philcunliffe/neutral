// @ts-check
// `neutral ready <changeset-slug> [--json]` — the unblocked-open task queue for a
// change set, derived from its plan LLP's `## Tasks` block + git ground truth.
// @ref LLP 0003#ready-queue-the-unblocked-open-list
import { readFileSync } from 'node:fs'
import { readLlps } from '../llp.js'
import { loadConfig } from '../config.js'
import { parseTasks } from '../tasks.js'
import { doneSetFromGit } from '../git.js'
import { readyTasks } from '../ready.js'

/** @import { Task } from '../types.d.ts' */

/**
 * @param {Task[]} tasks
 * @param {string} label
 * @returns {string}
 */
function list(tasks, label) {
  if (!tasks.length) return `  ${label}: (none)`
  return `  ${label}:\n` + tasks.map(t => `    ${t.id}  ${t.branch}${t.brief ? '  — ' + t.brief : ''}`).join('\n')
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function readyCommand(repo, args) {
  const slug = args.find(a => !a.startsWith('--'))
  if (!slug) {
    process.stderr.write('usage: neutral ready <changeset-slug> [--json]\n')
    return 2
  }
  // The plan is the LLP for this change set that carries a `## Tasks` block.
  const plan = readLlps(repo, loadConfig(repo))
    .filter(l => l.slug === slug)
    .find(l => /^##\s+Tasks\s*$/m.test(readFileSync(l.path, 'utf8')))
  if (!plan) {
    process.stderr.write(`neutral: no plan LLP (with a ## Tasks block) for change set "${slug}"\n`)
    return 2
  }
  const tasks = parseTasks(readFileSync(plan.path, 'utf8'))
  const integration = `integration/${slug}`
  const done = await doneSetFromGit(repo, integration, tasks)
  const r = readyTasks(tasks, done)

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ slug, integration, ...r }, null, 2) + '\n')
  } else {
    process.stdout.write(
      `change set ${slug}  (integration: ${integration})\n` +
      list(r.ready, 'ready') + '\n' +
      list(r.blocked, 'blocked') + '\n' +
      list(r.done, 'done') + '\n'
    )
  }
  return 0
}
