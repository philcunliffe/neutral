// @ts-check
// `neutral observe [--json]` — the tick's whole observation step as ONE command: both
// reconciler families' gaps in a single report, so no family can be skipped by prose.
// The gap list IS the idle predicate's blocker list (one derivation, two consumers):
// exit 0 ⇔ no gap (neutral state), exit 1 ⇔ gaps remain, mirroring `neutral backlog`.
// @ref LLP 0052#single-observe-surface [implements] — one command reports every gap
import { run } from '../git.js'
import { collectBacklog } from './backlog.js'
import { collectImplementable } from '../implementable.js'
import { collectChangeSets } from '../changesets.js'
import { collectPRs } from './prs.js'
import { collectIssues } from './issues.js'
import { idleState } from '../idle.js'
import { admissionState } from '../admission.js'
import { loadConfig } from '../config.js'
import { padStart } from '../format.js'

/** @import { ChangeSetState, IdleBlocker, IssueFixState, Llp } from '../types.d.ts' */

/**
 * Assemble the full observation: every gap in both families, plus the blockers view
 * (empty ⇔ neutral state). Each collector degrades to empty on git/gh failure, so the
 * report is offline-safe like its parts.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<{ backlog: Llp[], implementable: Array<{number: number, slug: string, title: string}>, changesets: ChangeSetState[], prs: Awaited<ReturnType<typeof collectPRs>>, issues: IssueFixState[], admission: import('../types.d.ts').AdmissionState, neutral: boolean, gaps: IdleBlocker[] }>}
 */
export async function collectObserve(repo, exec = run) {
  const { maxActiveWork } = loadConfig(repo)
  const [{ backlog }, implementable, prs, issues] = await Promise.all([
    collectBacklog(repo),
    collectImplementable(repo, exec),
    collectPRs(repo, exec),
    collectIssues(repo, exec)
  ])
  const changesets = await collectChangeSets(repo, exec, { openHeads: new Set(prs.map(p => p.head)) })
  const { idle, blockers } = idleState({ backlog, implementable, changesets, prs, issues })
  const admission = admissionState({ changesets, prs, issues }, maxActiveWork)
  return { backlog, implementable, changesets, prs, issues, admission, neutral: idle, gaps: blockers }
}

/**
 * @param {ChangeSetState} c
 * @returns {string}
 */
function changesetLine(c) {
  const counts = `${c.done.length} done / ${c.ready.length} ready / ${c.blocked.length} blocked`
  return `  ${c.slug}  ${c.action ?? 'none'} — ${c.reason}  [${counts}]`
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @returns {Promise<number>}
 */
export async function observeCommand(repo, args, exec = run) {
  const o = await collectObserve(repo, exec)

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(o, null, 2) + '\n')
  } else {
    const none = '  (none)'
    process.stdout.write(
      (o.neutral ? 'observe: neutral state — no gaps\n' : `observe: ${o.gaps.length} gap(s)\n`) +
      `admission: ${o.admission.used}/${o.admission.limit} active, ${o.admission.available} available — ${o.admission.open ? 'OPEN' : 'PAUSED'}\n` +
      'pipeline\n' +
      ' backlog — requests needing a design:\n' +
      (o.backlog.length ? o.backlog.map(l => `  ${padStart(String(l.number), 4, '0')}  ${l.title}  [${l.type}]`).join('\n') : none) + '\n' +
      ' implementable — Accepted designs owed an implementation:\n' +
      (o.implementable.length ? o.implementable.map(d => `  ${padStart(String(d.number), 4, '0')}  ${d.slug}  ${d.title}`).join('\n') : none) + '\n' +
      ' change sets — integration/* with their owed action:\n' +
      (o.changesets.length ? o.changesets.map(changesetLine).join('\n') : none) + '\n' +
      'maintenance\n' +
      ' prs — in-scope open PRs with their rung action:\n' +
      (o.prs.length ? o.prs.map(p => `  #${p.number}  ${p.head}  ${p.action} — ${p.reason}`).join('\n') : none) + '\n' +
      ' issues — open neutral:fix issues:\n' +
      (o.issues.length ? o.issues.map(i => `  #${i.number}  ${i.title}  state=${i.state}${i.via ? ' (' + i.via + ')' : ''}`).join('\n') : none) + '\n'
    )
  }
  return o.neutral ? 0 : 1
}
