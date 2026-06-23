// @ts-check
// The unblocked-open queue — the git-native equivalent of `bd ready`. Pure:
// callers derive `doneSet` from git ground truth (see src/git.js).
// @ref LLP 0003#ready-queue-the-unblocked-open-list [implements]

/** @import { Task, ReadyResult } from './types.d.ts' */

/**
 * Partition tasks into done / ready / blocked given the derived done-set.
 *
 * - done    = id ∈ doneSet (branch is a verified ancestor of integration)
 * - ready   = not done and every dependency is done
 * - blocked = not done and some dependency is not done
 *
 * @param {Task[]} tasks
 * @param {Set<string>} doneSet
 * @returns {ReadyResult}
 */
export function readyTasks(tasks, doneSet) {
  /** @type {Task[]} */
  const ready = []
  /** @type {Task[]} */
  const blocked = []
  /** @type {Task[]} */
  const done = []
  for (const t of tasks) {
    if (doneSet.has(t.id)) {
      done.push(t)
    } else if (t.deps.every(d => doneSet.has(d))) {
      ready.push(t)
    } else {
      blocked.push(t)
    }
  }
  return { ready, blocked, done }
}

/**
 * Topological order over tasks (dependencies before dependents). Throws on a
 * dependency cycle — a cycle is a malformed change set, not something to merge
 * around silently.
 * @param {Task[]} tasks
 * @returns {Task[]}
 */
export function topoOrder(tasks) {
  /** @type {Map<string, Task>} */
  const byId = new Map(tasks.map(t => [t.id, t]))
  /** @type {Set<string>} */
  const visited = new Set()
  /** @type {Set<string>} */
  const onStack = new Set()
  /** @type {Task[]} */
  const out = []

  /** @param {string} id */
  function visit(id) {
    if (visited.has(id)) return
    if (onStack.has(id)) throw new Error(`dependency cycle through task "${id}"`)
    const t = byId.get(id)
    if (!t) return
    onStack.add(id)
    for (const d of t.deps) visit(d)
    onStack.delete(id)
    visited.add(id)
    out.push(t)
  }

  for (const t of tasks) visit(t.id)
  return out
}
