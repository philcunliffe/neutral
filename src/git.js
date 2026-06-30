// @ts-check
// Git ground-truth helpers — the ONLY core module that shells out. Completion is
// read from the commit graph, which a status field cannot fake.
// @ref LLP 0002#how-to-apply [implements] — merged? = verified ancestor
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { parseLlp } from './llp.js'
import { extractRefs } from './refs.js'
import { DEFAULT_CONFIG } from './config.js'

/** @import { Task, Llp, NeutralConfig } from './types.d.ts' */

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
 * Branch short-names under `<prefix>` (the path component before the first `/`),
 * local and remote, deduped with the `origin/` stripped. `for-each-ref` matches a
 * pattern at `/` boundaries, so a prefix like `fix` returns every `fix/*` branch.
 * @param {string} repo
 * @param {string} prefix
 * @param {typeof run} [exec]
 * @returns {Promise<string[]>}
 */
export async function branchesWithPrefix(repo, prefix, exec = run) {
  const out = await exec('git', ['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`, `refs/remotes/origin/${prefix}`], repo)
  /** @type {Set<string>} */
  const set = new Set()
  for (const line of out.split('\n').map(s => s.trim()).filter(Boolean)) {
    set.add(line.replace(/^origin\//, ''))
  }
  return [...set]
}

/**
 * The `integration/*` change-set branch names, local and remote, deduped to the
 * `integration/<slug>` short form.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<string[]>}
 */
export async function integrationBranches(repo, exec = run) {
  return branchesWithPrefix(repo, 'integration', exec)
}

/**
 * A change set counts as merged to target when its `design` LLP is present on the
 * (fetched) target branch AND that design is `Status: Active` — "built and merged"
 * (LLP 0003/0015). Presence alone is not enough: a design-first merge lands the doc
 * at `Status: Accepted` (approved-but-unbuilt) ahead of any code, and that must NOT
 * read as shipped — the design-first intake (`neutral implementable`) still owes it
 * an implementation, which flips it to Active. Active-on-target is git-native and
 * robust to how the PR merged (squash, merge commit, rebase), unlike a trailer.
 * @param {string} repo
 * @param {string} slug
 * @param {string} targetRef  e.g. `origin/main`
 * @param {typeof run} [exec]
 * @returns {Promise<boolean>}
 * @ref LLP 0016#shipped-is-active [implements] — shipped ⇔ design Active on target
 */
export async function changeSetMergedToTarget(repo, slug, targetRef, exec = run) {
  if (!(await branchExists(repo, targetRef, exec))) return false
  let listing
  try {
    listing = await exec('git', ['ls-tree', '-r', '--name-only', targetRef, 'llp/'], repo)
  } catch {
    return false
  }
  const re = new RegExp(`-${slug}\\.design\\.md$`)
  const path = listing.split('\n').map(s => s.trim()).find(f => re.test(f))
  if (!path) return false
  // A design merged doc-first is Accepted (approved-but-unbuilt); only Active is shipped.
  const body = await showFile(repo, targetRef, path, exec)
  if (body === null) return false
  const llp = parseLlp(basename(path), body)
  return !!llp && llp.status.toLowerCase() === 'active'
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

/**
 * Parse the LLP corpus AT A GIT REF (e.g. the fetched `origin/<default>`), not the
 * working tree. The reconcile tick only `git fetch`es and never updates the main
 * checkout (read-only; LLP 0012), so a request merged to the default branch after the
 * local checkout was last pulled is invisible to a working-tree read. Reading from the
 * ref is the same ground-truth move `collectImplementable` already makes — observe the
 * MERGED corpus from git (LLP 0002), so a new request on master is seen the next tick.
 * git/missing-ref failures degrade to an empty corpus, never an exception.
 * @param {string} repo
 * @param {string} ref  e.g. `origin/main`
 * @param {NeutralConfig} [config]
 * @param {typeof run} [exec]
 * @returns {Promise<Llp[]>}
 */
export async function readLlpsFromRef(repo, ref, config = DEFAULT_CONFIG, exec = run) {
  let listing
  try {
    listing = await exec('git', ['ls-tree', '-r', '--name-only', ref, config.llpDir + '/'], repo)
  } catch {
    return []
  }
  /** @type {Llp[]} */
  const llps = []
  for (const file of listing.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (!/\.md$/.test(file)) continue
    const body = await showFile(repo, ref, file, exec)
    if (body === null) continue
    const llp = parseLlp(basename(file), body, file.includes('/tombstones/'))
    if (!llp) continue
    llp.path = file
    llps.push(llp)
  }
  llps.sort((a, b) => a.number - b.number)
  return llps
}

/**
 * The LLP numbers `@ref`'d by source code AT A GIT REF — the code-realized half of the
 * coverage signal, read from the same merged ground truth as {@link readLlpsFromRef}
 * (not the stale working tree). One `git grep` over the ref's tree (tracked files only,
 * so gitignored build dirs are excluded for free) restricted to the configured code
 * extensions; the canonical {@link extractRefs} regex pulls the numbers from the
 * matching lines. `git grep` exits 1 when nothing matches — that is "no code refs", not
 * an error; any git failure degrades to an empty set (coverage fails toward surfacing
 * work, never toward hiding it).
 * @param {string} repo
 * @param {string} ref
 * @param {NeutralConfig} [config]
 * @param {typeof run} [exec]
 * @returns {Promise<Set<number>>}
 */
export async function readCodeRefsFromRef(repo, ref, config = DEFAULT_CONFIG, exec = run) {
  const pathspecs = config.code.exts.map(e => `*${e}`)
  let out
  try {
    out = await exec('git', ['grep', '-h', '-I', '--no-color', '-E', '@ref', ref, '--', ...pathspecs], repo)
  } catch {
    // exit 1 = no matches; any other git failure degrades to empty (never throws).
    return new Set()
  }
  return new Set(extractRefs(out))
}
