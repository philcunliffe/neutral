// @ts-check
// Parse the `## Tasks` block of a `plan` LLP into Task[]. Fails LOUDLY on any
// line it cannot parse — a silently dropped task reads as a premature "all done".
// @ref LLP 0003#tasks [implements]
import { topoOrder } from './ready.js'

/** @import { Task } from './types.d.ts' */

// `- id: T1  branch: task/<slug>/T1  deps: [T2, T3]  -- brief`
const TASK_LINE = /^-\s*id:\s*(\S+)\s+branch:\s*(\S+)\s+deps:\s*\[([^\]]*)\]\s*(?:(?:--|—)\s*(.*))?$/

/**
 * Extract the body of the `## Tasks` section (until the next `##` heading or EOF).
 * @param {string} md
 * @returns {string | null}
 */
function tasksSection(md) {
  const lines = md.split('\n')
  let i = lines.findIndex(l => /^##\s+Tasks\s*$/i.test(l))
  if (i < 0) return null
  /** @type {string[]} */
  const out = []
  for (i = i + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

/**
 * Parse the `## Tasks` block of a plan LLP body. Throws on a malformed line, a
 * duplicate id, an unknown dependency, or a dependency cycle.
 * @param {string} md
 * @returns {Task[]}
 */
export function parseTasks(md) {
  const section = tasksSection(md)
  if (section === null) throw new Error('plan LLP has no "## Tasks" section')

  /** @type {Task[]} */
  const tasks = []
  for (const raw of section.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (!line.startsWith('-')) continue // prose inside the section is allowed
    const m = line.match(TASK_LINE)
    if (!m) throw new Error(`malformed task line: ${raw.trim()}`)
    const [, id, branch, depsRaw, brief] = m
    const deps = depsRaw.split(',').map(s => s.trim()).filter(Boolean)
    tasks.push({ id, branch, deps, brief: brief ? brief.trim() : undefined })
  }

  /** @type {Set<string>} */
  const ids = new Set()
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`duplicate task id: ${t.id}`)
    ids.add(t.id)
  }
  for (const t of tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) throw new Error(`task ${t.id} depends on unknown task ${d}`)
    }
  }
  topoOrder(tasks) // throws on a dependency cycle
  return tasks
}
