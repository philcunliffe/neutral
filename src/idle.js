// @ts-check
// idle: is this tick at rest across BOTH reconciler families, with nothing in flight?
// A PURE classifier over the three observe outputs (backlog / prs / issues), so the
// orchestrator ACTS on the signal rather than re-deciding it in prose — and it is
// unit-tested offline like the other classifiers (prhealth.js, issuefix.js). idle is
// half the context-autophagy trigger; the other half is measured context size.
// @ref LLP 0013#trigger [implements] — the idle predicate
// @ref LLP 0002#principle [constrained-by] — idle is ground truth, never self-report

/** @import { IdleState, IdleBlocker } from './types.d.ts' */

// A PR is at rest only when its rung action is `held` (terminal — already held for a
// human). Everything else is work: `wait` is in flight (mergeability UNKNOWN or checks
// PENDING — LLP 0002: not-yet-observable ≠ at-rest), `ready-hold` still has to flip the
// draft, the rest are active rungs. Recycling while a check runs would strand it, so
// idle admits only `held`.
// @ref LLP 0013#trigger [constrained-by] — wait is not idle
const PR_AT_REST = 'held'

/**
 * Classify whether a tick is idle from the three observe outputs, returning the idle
 * verdict plus the blockers that hold it open (empty ⇔ idle), so the orchestrator can
 * log *why* it is not recycling. A tick is idle ⇔ the repo is at neutral state and
 * nothing is in flight (LLP 0008):
 *
 *   - `neutral backlog` is empty (no uncovered request LLP), AND
 *   - every in-scope PR's action is `held` (terminal), AND
 *   - no issue is `needs-fix`.
 *
 * `stuck` issues/PRs do NOT block idle — neutral can do nothing autonomous about them
 * (a human must look); they are surfaced, not in flight.
 * @param {{ backlog?: Array<{number?: number, title?: string}>, prs?: Array<{number: number, action: string}>, issues?: Array<{number: number, state: string}> }} obs
 * @returns {IdleState}
 * @ref LLP 0013#trigger [implements]
 */
export function idleState({ backlog = [], prs = [], issues = [] } = {}) {
  /** @type {IdleBlocker[]} */
  const blockers = []
  for (const r of backlog) {
    blockers.push({ family: 'pipeline', target: `llp#${r.number ?? '?'}`, reason: 'uncovered request — needs a design' })
  }
  for (const p of prs) {
    if (p.action !== PR_AT_REST) {
      blockers.push({ family: 'maintenance', target: `pr#${p.number}`, reason: `action=${p.action}` })
    }
  }
  for (const i of issues) {
    if (i.state === 'needs-fix') {
      blockers.push({ family: 'maintenance', target: `issue#${i.number}`, reason: 'needs-fix — no fix attempt yet' })
    }
  }
  return { idle: blockers.length === 0, blockers }
}
