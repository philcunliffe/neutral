// @ts-check
// `neutral prs [--json]` — the PR-health observe surface: every in-scope open PR
// (neutral's OWN `integration/*` change sets and `fix/issue-*` fixes) with the one
// rung action reconcilePR should take this tick, plus every MERGED adoption still
// owed its `neutral:adopted` completion record (LLP 0031). This is the loop's eyes for the
// maintenance family — the deterministic rung decision lives here, not in skill
// prose, so it is unit-tested rather than an agent's judgement.
// @ref LLP 0009#pr-health-reconciler [implements]
import { run } from '../git.js'
import { listOpenPRs, listMergedAdoptPRs, viewPR } from '../github.js'
import { selectRung, humanRepliesAfterStuckReport, needsAdoptedLabel } from '../prhealth.js'
import { loadConfig, ADOPT_LABEL, ADOPTED_LABEL, REVIEW_LABEL } from '../config.js'

// In scope: neutral's OWN integration/fix PRs (by ownership, no label), PLUS foreign PRs a
// maintainer delegated with `neutral:adopt` (LLP 0025). The label is the authorization for the
// foreign case, exactly as `neutral:fix` is for an issue; own PRs need none. An adopted PR runs
// the same rung ladder, degraded by push access and terminating in a verdict label.
// @ref LLP 0025#trigger-and-authorization [implements] — in scope = own ∪ adopt
// @ref LLP 0008#scope [constrained-by] — adopted PRs are a separate axis from the change-set DAG
const OWN_HEAD_RE = /^(integration\/|fix\/issue-)/

/**
 * Observe every in-scope open PR and classify its rung. gh failures degrade to an
 * empty list (offline / no remote), never an exception. `guidance` counts the human
 * replies after the latest stuck report in the thread (LLP 0027) — non-zero means
 * every worker dispatched for this PR must be given the report + replies as context,
 * including after the label is removed (the guidance outlives the unstick).
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<Array<{number: number, head: string, base: string, isDraft: boolean, headSha: string, foreign: boolean, reviewOnly: boolean, canPush: boolean, guidance: number, rung: string, action: string, reason: string}>>}
 */
export async function collectPRs(repo, exec = run) {
  const { maxReviewRounds, automerge } = loadConfig(repo)
  const open = await listOpenPRs(repo, exec)
  // Own by head-branch ownership; foreign only when a maintainer explicitly delegated it —
  // `neutral:adopt` for full heal (LLP 0025) or `neutral:review` for review-only (LLP 0032).
  const inScope = open.filter(p => OWN_HEAD_RE.test(p.headRefName) || p.labels.includes(ADOPT_LABEL) || p.labels.includes(REVIEW_LABEL))
  /** @type {Array<{number: number, head: string, base: string, isDraft: boolean, headSha: string, foreign: boolean, reviewOnly: boolean, canPush: boolean, guidance: number, rung: string, action: string, reason: string}>} */
  const out = []
  for (const p of inScope) {
    const obs = await viewPR(repo, p.number, exec)
    if (!obs) continue
    // foreign ⇔ not an own head branch. A delegation label on an own PR is redundant — ownership wins.
    const foreign = !OWN_HEAD_RE.test(obs.head)
    // The narrower grant wins when both labels are present (LLP 0032): review-only forces
    // LLP 0025's no-push mode regardless of the observed push access.
    const reviewOnly = foreign && obs.labels.includes(REVIEW_LABEL)
    const decision = selectRung({ ...obs, foreign, reviewOnly }, maxReviewRounds, automerge)
    const guidance = humanRepliesAfterStuckReport(obs.comments).length
    out.push({ number: obs.number, head: obs.head, base: obs.base, isDraft: obs.isDraft, headSha: obs.headSha, foreign, reviewOnly, canPush: obs.canPush !== false, guidance, ...decision })
  }
  // Completion records (LLP 0031): a MERGED adoption has left the open-PR scope above but
  // still owes one act — `neutral:adopted`, the cache of merged ∧ adopt-labelled. Emitted as
  // a mechanical terminal action; set-if-absent, so the work-list self-terminates. Own heads
  // are skipped for the same reason as at enumeration: an adopt label on an own PR is
  // redundant — ownership wins, and an own PR is not an adoption.
  // @ref LLP 0031 [implements] — merged ∧ adopt ∧ ¬adopted → mark-adopted
  for (const p of await listMergedAdoptPRs(repo, exec)) {
    if (OWN_HEAD_RE.test(p.headRefName) || !needsAdoptedLabel(p.labels)) continue
    out.push({
      number: p.number, head: p.headRefName, base: '', isDraft: false, headSha: '',
      foreign: true, reviewOnly: false, canPush: true, guidance: 0, rung: 'terminal', action: 'mark-adopted',
      reason: `merged while carrying ${ADOPT_LABEL} — add ${ADOPTED_LABEL}, the adoption completion record (LLP 0031)`
    })
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
      const tag = p.foreign ? (p.reviewOnly ? '  [review]' : `  [adopt${p.canPush ? '' : ',review-only'}]`) : ''
      const guidance = p.guidance ? ` guidance=${p.guidance}` : ''
      process.stdout.write(`  #${p.number}  ${p.head}${tag}  rung=${p.rung} action=${p.action}${guidance} — ${p.reason}\n`)
    }
  }
  return 0
}
