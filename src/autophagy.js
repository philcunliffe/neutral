// @ts-check
// autophagy: may the code-cleanup initiative run this idle tick? A PURE classifier
// over the prs observe output plus config — like idle.js it lets the orchestrator
// ACT on the signal rather than re-deciding it, and is unit-tested offline.
// @ref LLP 0036#eligibility [implements] — the cleanup eligibility gate
// @ref LLP 0002#principle [constrained-by] — eligibility is observed, never self-report

/** @import { CleanupState, NeutralConfig } from './types.d.ts' */

// Repo-hygiene autophagy branches. The prefix is scope-defining (LLP 0036): prs.js
// admits it into the own-PR ladder, and one open PR under it blocks the next
// initiative — LLP 0011's "don't open 40 dead-code PRs" backoff, made mechanical.
// @ref LLP 0036#initiative [implements] — the autophagy/ branch namespace
export const AUTOPHAGY_PREFIX = 'autophagy/'

/**
 * Classify whether the code-cleanup initiative may run, from the open-PR observation
 * the maintenance family already reads — no new state. Ineligible while any
 * `autophagy/` PR is open (in flight OR held-unreviewed: the human must dispose of
 * the last proposal before the next one), or when the repo switched the member off.
 * @param {Array<{number: number, head: string}>} prs
 * @param {NeutralConfig} config
 * @returns {CleanupState}
 * @ref LLP 0036#eligibility [implements]
 */
export function cleanupState(prs, config) {
  if (!config.autophagy.codeCleanup) {
    return { eligible: false, reason: 'autophagy.codeCleanup is false in .neutral/config.json' }
  }
  const open = prs.find(p => p.head.startsWith(AUTOPHAGY_PREFIX))
  if (open) {
    return { eligible: false, reason: `pr#${open.number} (${open.head}) is open — one autophagy PR at a time` }
  }
  return { eligible: true, reason: 'no open autophagy PR' }
}
