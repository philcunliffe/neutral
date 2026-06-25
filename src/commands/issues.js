// @ts-check
// `neutral issues [--json]` — the issue-fix observe surface: every open `neutral:fix`
// issue with its fix-attempt state (needs-fix | attempt-exists | stuck), re-derived
// from `fix/issue-N` branches + `Fixes #N` PRs + labels, never a stored flag. The
// loop's eyes for the issue-fix reconciler.
// @ref LLP 0009#issue-fix-reconciler [implements]
import { run, branchesWithPrefix } from '../git.js'
import { listLabelledIssues, listOpenPRBodies } from '../github.js'
import { classifyIssue } from '../issuefix.js'
import { FIX_LABEL } from '../config.js'

/** @import { IssueFixState } from '../types.d.ts' */

/**
 * Observe and classify every open `neutral:fix` issue. gh / git failures degrade to
 * an empty list rather than throwing, keeping the call safe offline.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @param {string} [label]
 * @returns {Promise<IssueFixState[]>}
 */
export async function collectIssues(repo, exec = run, label = FIX_LABEL) {
  const issues = await listLabelledIssues(repo, label, exec)
  if (!issues.length) return []
  /** @type {string[]} */
  let branches = []
  try {
    branches = await branchesWithPrefix(repo, 'fix', exec)
  } catch { /* not a git repo / no fix branches — none observed */ }
  const prs = await listOpenPRBodies(repo, exec)
  return issues.map(i => ({ number: i.number, title: i.title, ...classifyIssue(i.number, { branches, prs, labels: i.labels }) }))
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @returns {Promise<number>}
 */
export async function issuesCommand(repo, args, exec = run) {
  const issues = await collectIssues(repo, exec)
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(issues, null, 2) + '\n')
  } else if (!issues.length) {
    process.stdout.write(`  (no open ${FIX_LABEL} issues)\n`)
  } else {
    for (const i of issues) {
      process.stdout.write(`  #${i.number}  ${i.title}  state=${i.state}${i.via ? ' (' + i.via + ')' : ''}\n`)
    }
  }
  return 0
}
