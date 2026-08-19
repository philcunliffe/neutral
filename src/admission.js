// @ts-check
// Pure admission control over the tick's existing observations. It limits new work
// without interrupting maintenance of work already in flight.
// @ref LLP 0060#admission-control [implements]

/** @import { AdmissionState, AdmissionSurface, ChangeSetState, IssueFixState } from './types.d.ts' */

/**
 * Count the work surfaces Neutral already owns. An open PR replaces its underlying
 * integration/fix branch as the one visible surface, so the sets are deduplicated.
 * A genuinely held `neutral:stuck` artifact is frozen: it remains visible but does
 * not consume capacity. A replied-to stuck PR (`unstick`) is active again.
 *
 * @param {{ changesets?: ChangeSetState[], prs?: Array<{number: number, head: string, action: string, stuck?: boolean}>, issues?: IssueFixState[] }} obs
 * @param {number} limit
 * @returns {AdmissionState}
 */
export function admissionState({ changesets = [], prs = [], issues = [] } = {}, limit = 4) {
  /** @type {AdmissionSurface[]} */
  const active = []
  /** @type {AdmissionSurface[]} */
  const frozen = []
  const openHeads = new Set()

  for (const p of prs) {
    if (p.action === 'mark-adopted') continue
    openHeads.add(p.head)
    const surface = { kind: /** @type {'pr'} */ ('pr'), target: `pr#${p.number}`, reason: p.head }
    if (p.stuck && (p.action === 'held' || p.action === 'stuck-report')) frozen.push(surface)
    else active.push(surface)
  }

  for (const c of changesets) {
    if (c.shipped || openHeads.has(c.integration)) continue
    active.push({ kind: 'changeset', target: `changeset/${c.slug}`, reason: c.integration })
  }

  for (const i of issues) {
    if (i.state === 'stuck') {
      frozen.push({ kind: 'issue', target: `issue#${i.number}`, reason: i.via || 'stuck' })
      continue
    }
    if (i.state !== 'attempt-exists' || !i.via) continue
    if (i.via.startsWith('pr:#')) continue
    const branch = i.via.startsWith('branch:') ? i.via.slice('branch:'.length) : ''
    if (branch && openHeads.has(branch)) continue
    active.push({ kind: 'issue', target: `issue#${i.number}`, reason: i.via })
  }

  const safeLimit = Number.isInteger(limit) && limit >= 0 ? limit : 4
  const available = Math.max(0, safeLimit - active.length)
  return {
    limit: safeLimit,
    used: active.length,
    available,
    open: available > 0,
    active,
    frozen,
    reason: available > 0
      ? `${available} new work slot(s) available`
      : `at capacity (${active.length}/${safeLimit}) — reconcile existing work; admit no new branch or PR`
  }
}
