// @ts-check
// Git ground-truth helpers — the ONLY core module that shells out. Completion is
// read from the commit graph, which a status field cannot fake.
// @ref LLP 0002#how-to-apply [implements] — merged? = verified ancestor
import { execFile } from 'node:child_process'

/** @import { Task } from './types.d.ts' */

/**
 * Run a command, resolve stdout. Injectable so deterministic tests never touch a
 * real repo. The error carries `.code` (the process exit code) like execFile.
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 1 << 24 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(String(stdout))
    })
  })
}

/**
 * True iff a ref resolves to a commit. `rev-parse --verify --quiet` exits 1 when
 * the ref is missing.
 * @param {string} repo
 * @param {string} ref
 * @param {typeof run} [exec]
 * @returns {Promise<boolean>}
 */
export async function branchExists(repo, ref, exec = run) {
  try {
    const out = await exec('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo)
    return out.trim().length > 0
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 1) return false
    throw err
  }
}

/**
 * True iff commit-ish `a` is an ancestor of `b`. `merge-base --is-ancestor` exits
 * 0 when true, 1 when false; any other exit code (e.g. a bad ref) re-throws — we
 * do not silently treat an error as "not merged".
 * @param {string} repo
 * @param {string} a
 * @param {string} b
 * @param {typeof run} [exec]
 * @returns {Promise<boolean>}
 */
export async function isAncestor(repo, a, b, exec = run) {
  try {
    await exec('git', ['merge-base', '--is-ancestor', a, b], repo)
    return true
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 1) return false
    throw err
  }
}

/**
 * Resolve a branch name to the ref that actually exists, preferring the
 * remote-tracking ref (`origin/<name>`, where worktree agents push) over a local
 * branch. Returns null if neither resolves.
 * @param {string} repo
 * @param {string} name
 * @param {typeof run} [exec]
 * @returns {Promise<string | null>}
 */
export async function resolveRef(repo, name, exec = run) {
  if (await branchExists(repo, `origin/${name}`, exec)) return `origin/${name}`
  if (await branchExists(repo, name, exec)) return name
  return null
}

/**
 * Derive the done-set for a change set's tasks from git ground truth: a task is
 * done iff its branch is a verified ancestor of the integration branch. Refs are
 * resolved against `origin/*` first (where the implementer pushes). A missing
 * integration branch means "nothing done yet"; a missing task branch means "that
 * task is not done" — neither is an error.
 * @param {string} repo
 * @param {string} integration
 * @param {Task[]} tasks
 * @param {typeof run} [exec]
 * @returns {Promise<Set<string>>}
 */
export async function doneSetFromGit(repo, integration, tasks, exec = run) {
  /** @type {Set<string>} */
  const done = new Set()
  const integ = await resolveRef(repo, integration, exec)
  if (!integ) return done
  for (const t of tasks) {
    const br = await resolveRef(repo, t.branch, exec)
    if (!br) continue
    if (await isAncestor(repo, br, integ, exec)) done.add(t.id)
  }
  return done
}

/**
 * The repo's default (target) branch, as reported by the remote — never
 * hardcoded. Falls back to the local HEAD's branch when there is no remote.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<string>}
 */
export async function defaultBranch(repo, exec = run) {
  try {
    const out = await exec('gh', ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'], repo)
    if (out.trim()) return out.trim()
  } catch { /* no remote / gh — fall through */ }
  try {
    const out = await exec('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], repo)
    if (out.trim()) return out.trim().replace(/^origin\//, '')
  } catch { /* no origin HEAD */ }
  return (await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repo)).trim()
}

/**
 * The `integration/*` change-set branch names, local and remote, deduped to the
 * `integration/<slug>` short form.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<string[]>}
 */
export async function integrationBranches(repo, exec = run) {
  const out = await exec('git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/integration', 'refs/remotes/origin/integration'], repo)
  /** @type {Set<string>} */
  const set = new Set()
  for (const line of out.split('\n').map(s => s.trim()).filter(Boolean)) {
    set.add(line.replace(/^origin\//, ''))
  }
  return [...set]
}

/**
 * A change set counts as merged to target only when its squash commit — carrying a
 * `Change-Set: <slug>` trailer — is present on the (fetched) target branch.
 * @param {string} repo
 * @param {string} slug
 * @param {string} targetRef  e.g. `origin/main`
 * @param {typeof run} [exec]
 * @returns {Promise<boolean>}
 */
export async function changeSetMergedToTarget(repo, slug, targetRef, exec = run) {
  if (!(await branchExists(repo, targetRef, exec))) return false
  const out = await exec('git', ['log', targetRef, `--grep=Change-Set: ${slug}`, '--format=%H', '-n', '1'], repo)
  return out.trim().length > 0
}

/**
 * Read a file's contents at a git ref (e.g. a `design` LLP on an integration
 * branch). Returns null if the path does not exist at that ref.
 * @param {string} repo
 * @param {string} ref
 * @param {string} path
 * @param {typeof run} [exec]
 * @returns {Promise<string | null>}
 */
export async function showFile(repo, ref, path, exec = run) {
  try {
    return await exec('git', ['show', `${ref}:${path}`], repo)
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code !== 0) return null
    throw err
  }
}
