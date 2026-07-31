// @ts-check
// Change-set observe surface: every `integration/*` branch with its ready/blocked/done
// queues and the one gap action it is owed, derived entirely from git refs — the plan
// LLP is read from the branch's blob, never the working tree, so the sweep runs from
// the read-only main checkout (LLP 0012) with no worktree dance. This is the fourth
// pipeline-family observation, the one that previously had no command and got skipped.
// @ref LLP 0052#change-set-gaps-from-refs [implements] — change-set gaps derived from refs
import { run, resolveRef, integrationBranches, showFile, defaultBranch, changeSetMergedToTarget, doneSetFromGit } from './git.js'
import { loadConfig } from './config.js'
import { parseTasks } from './tasks.js'
import { readyTasks } from './ready.js'

/** @import { ChangeSetState, ReadyResult } from './types.d.ts' */

/**
 * PURE: fold one change set's observed facts into the gap action the tick owes it.
 * Unit-tested offline like the other classifiers (idleState, selectRung, classifyIssue).
 * @param {{ shipped: boolean, plan: string | null, tasks: ReadyResult | null, hasOpenPR: boolean }} obs
 * @returns {{ action: 'plan' | 'implement' | 'create-pr' | null, reason: string }}
 * @ref LLP 0052#change-set-gaps-from-refs [implements] — the per-change-set action
 */
export function changeSetAction({ shipped, plan, tasks, hasOpenPR }) {
  if (shipped) return { action: null, reason: 'design Active on target — shipped (LLP 0016)' }
  if (!plan || !tasks) return { action: 'plan', reason: 'no parseable plan LLP with a ## Tasks block on the branch — Impl-designer owes a plan' }
  const total = tasks.ready.length + tasks.blocked.length + tasks.done.length
  if (total === 0) return { action: 'plan', reason: 'plan LLP has an empty ## Tasks block — Impl-designer owes tasks' }
  if (tasks.ready.length) {
    return { action: 'implement', reason: `${tasks.ready.length} task(s) unblocked: ${tasks.ready.map(t => t.id).join(',')}` }
  }
  if (tasks.done.length === total) {
    if (hasOpenPR) return { action: null, reason: 'all tasks merged; open PR carries it — the maintenance family drives it' }
    return { action: 'create-pr', reason: 'all tasks merged, no PR for the integration branch' }
  }
  return { action: null, reason: 'remaining tasks blocked on in-flight work' }
}

/**
 * Observe every `integration/*` change set from git ground truth. The plan is the
 * branch's LLP for the slug carrying a `## Tasks` section (same semantics as `neutral
 * ready`), read via `git show` at the ref. A malformed plan classifies as the `plan`
 * gap with the parse error as the reason — fail loudly toward surfacing work, never
 * toward hiding it (LLP 0002). git/gh failures degrade to an empty list (offline-safe,
 * like the sibling observers); `openHeads` is the open-PR head-branch set from the
 * maintenance observation, used to tell `create-pr` from an in-flight rollup.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @param {{ openHeads?: Set<string> }} [opts]
 * @returns {Promise<ChangeSetState[]>}
 */
export async function collectChangeSets(repo, exec = run, { openHeads = new Set() } = {}) {
  const config = loadConfig(repo)
  /** @type {string[]} */
  let branches
  try {
    branches = await integrationBranches(repo, exec)
  } catch {
    return []
  }
  if (!branches.length) return []
  /** @type {string | null} */
  let targetRef = null
  try {
    targetRef = await resolveRef(repo, await defaultBranch(repo, exec), exec)
  } catch { /* no remote / gh — shipped check degrades to false */ }

  /** @type {ChangeSetState[]} */
  const out = []
  for (const integration of branches.sort()) {
    const slug = integration.replace(/^integration\//, '')
    const ref = await resolveRef(repo, integration, exec)
    if (!ref) continue
    const shipped = targetRef ? await changeSetMergedToTarget(repo, slug, targetRef, exec) : false
    const { plan, tasks, error } = await readPlanFromRef(repo, ref, slug, config.llpDir, exec)
    /** @type {ReadyResult | null} */
    let queues = null
    if (tasks) {
      const done = await doneSetFromGit(repo, integration, tasks, exec)
      queues = readyTasks(tasks, done)
    }
    const { action, reason } = changeSetAction({ shipped, plan, tasks: queues, hasOpenPR: openHeads.has(integration) })
    out.push({
      slug, integration, plan, shipped, action,
      reason: error ? `${reason} (${error})` : reason,
      ready: queues ? queues.ready : [], blocked: queues ? queues.blocked : [], done: queues ? queues.done : []
    })
  }
  return out
}

/**
 * Find and parse the slug's plan LLP at a git ref: the `llp/*-<slug>.*.md` file whose
 * body carries a `## Tasks` section. Returns the plan path plus parsed tasks, or an
 * `error` when a plan exists but its tasks fail to parse.
 * @param {string} repo
 * @param {string} ref
 * @param {string} slug
 * @param {string} llpDir
 * @param {typeof run} exec
 * @returns {Promise<{ plan: string | null, tasks: import('./types.d.ts').Task[] | null, error: string | null }>}
 */
async function readPlanFromRef(repo, ref, slug, llpDir, exec) {
  let listing
  try {
    listing = await exec('git', ['ls-tree', '-r', '--name-only', ref, llpDir + '/'], repo)
  } catch {
    return { plan: null, tasks: null, error: null }
  }
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`-${esc}\\.[^/]+\\.md$`)
  for (const file of listing.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (!re.test(file)) continue
    const body = await showFile(repo, ref, file, exec)
    if (body === null || !/^##\s+Tasks\s*$/m.test(body)) continue
    try {
      return { plan: file, tasks: parseTasks(body), error: null }
    } catch (err) {
      return { plan: file, tasks: null, error: err instanceof Error ? err.message : String(err) }
    }
  }
  return { plan: null, tasks: null, error: null }
}
