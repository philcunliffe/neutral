// @ts-check
// `neutral prs [--json]` — the PR-health observe surface: every in-scope open PR
// (neutral's OWN `integration/*` change sets and `fix/issue-*` fixes) with the one
// rung action reconcilePR should take this tick. This is the loop's eyes for the
// maintenance family — the deterministic rung decision lives here, not in skill
// prose, so it is unit-tested rather than an agent's judgement.
// @ref LLP 0009#pr-health-reconciler [implements]
import { run } from '../git.js'
import { listOpenPRs, viewPR } from '../github.js'
import { selectRung } from '../prhealth.js'

// In scope by ownership: neutral's own integration and fix PRs. Foreign
// `neutral:adopt` PRs are deferred (handled manually for now), which is what lets us
// drop `canPush` detection — every in-scope PR is one neutral can always push to.
// @ref LLP 0008#scope [implements] — own PRs only; foreign-PR adoption deferred
const OWN_HEAD_RE = /^(integration\/|fix\/issue-)/

/**
 * Observe every in-scope open PR and classify its rung. gh failures degrade to an
 * empty list (offline / no remote), never an exception.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<Array<{number: number, head: string, base: string, isDraft: boolean, headSha: string, rung: string, action: string, reason: string}>>}
 */
export async function collectPRs(repo, exec = run) {
  const open = await listOpenPRs(repo, exec)
  const own = open.filter(p => OWN_HEAD_RE.test(p.headRefName))
  /** @type {Array<{number: number, head: string, base: string, isDraft: boolean, headSha: string, rung: string, action: string, reason: string}>} */
  const out = []
  for (const p of own) {
    const obs = await viewPR(repo, p.number, exec)
    if (!obs) continue
    const decision = selectRung(obs)
    out.push({ number: obs.number, head: obs.head, base: obs.base, isDraft: obs.isDraft, headSha: obs.headSha, ...decision })
  }
  return out
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @returns {Promise<number>}
 */
export async function prsCommand(repo, args, exec = run) {
  const prs = await collectPRs(repo, exec)
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(prs, null, 2) + '\n')
  } else if (!prs.length) {
    process.stdout.write('  (no in-scope open PRs)\n')
  } else {
    for (const p of prs) {
      process.stdout.write(`  #${p.number}  ${p.head}  rung=${p.rung} action=${p.action} — ${p.reason}\n`)
    }
  }
  return 0
}
