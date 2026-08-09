// @ts-check
// `neutral prs [--json]` — the PR-health observe surface: every in-scope open PR
// (neutral's OWN `integration/*` change sets, `fix/issue-*` fixes and `autophagy/*`
// cleanup proposals) with the one
// rung action reconcilePR should take this tick, plus every MERGED adoption still
// owed its `neutral:adopted` completion record (LLP 0031). This is the loop's eyes for the
// maintenance family — the deterministic rung decision lives here, not in skill
// prose, so it is unit-tested rather than an agent's judgement.
// @ref LLP 0009#pr-health-reconciler [implements]
import { run } from '../git.js'
import { listOpenPRs, listMergedAdoptPRs, viewPR } from '../github.js'
import { selectRung, humanRepliesAfterStuckReport, needsAdoptedLabel } from '../prhealth.js'
import { loadConfig, ADOPT_LABEL, ADOPTED_LABEL, REVIEW_LABEL } from '../config.js'
import { AUTOPHAGY_PREFIX } from '../autophagy.js'

// In scope: neutral's OWN integration/fix PRs (by ownership, no label), PLUS PRs a
// maintainer delegated with `neutral:adopt` (LLP 0025). The label is the authorization for the
// delegated case, exactly as `neutral:fix` is for an issue; own PRs need none. A pushable
// adoption rides the own-PR ladder end-to-end (LLP 0058); only review-only delegations run
// the degraded foreign ladder terminating in a verdict label.
// @ref LLP 0025#trigger-and-authorization [implements] — in scope = own ∪ adopt
// @ref LLP 0008#scope [constrained-by] — adopted PRs are a separate axis from the change-set DAG
// @ref LLP 0036#initiative [implements] — autophagy/ cleanup PRs ride the own-PR ladder
const OWN_HEAD_RE = /^(integration\/|fix\/issue-|autophagy\/)/

/**
 * Observe every in-scope open PR and classify its rung. gh failures degrade to an
 * empty list (offline / no remote), never an exception. `guidance` counts the human
 * replies after the latest stuck report in the thread (LLP 0027) — non-zero means
 * every worker dispatched for this PR must be given the report + replies as context,
 * including after the label is removed (the guidance outlives the unstick).
 * `markAdopted` (LLP 0037) flags an open adopted PR still missing `neutral:adopted`:
 * the skill stamps the label set-if-absent alongside the rung action — engagement,
 * not completion, is what the label records.
 * @param {string} repo
 * @param {typeof run} [exec]
 * @returns {Promise<Array<{number: number, head: string, base: string, isDraft: boolean, headSha: string, foreign: boolean, reviewOnly: boolean, adopted: boolean, canPush: boolean, guidance: number, markAdopted: boolean, rung: string, action: string, reason: string}>>}
 */
export async function collectPRs(repo, exec = run) {
  const { maxReviewRounds, automerge } = loadConfig(repo)
  const open = await listOpenPRs(repo, exec)
  // Own by head-branch ownership; delegated only when a maintainer explicitly labelled it —
  // `neutral:adopt` for full heal (LLP 0025) or `neutral:review` for review-only (LLP 0032).
  const inScope = open.filter(p => OWN_HEAD_RE.test(p.headRefName) || p.labels.includes(ADOPT_LABEL) || p.labels.includes(REVIEW_LABEL))
  /** @type {Array<{number: number, head: string, base: string, isDraft: boolean, headSha: string, foreign: boolean, reviewOnly: boolean, adopted: boolean, canPush: boolean, guidance: number, markAdopted: boolean, rung: string, action: string, reason: string}>} */
  const out = []
  for (const p of inScope) {
    const obs = await viewPR(repo, p.number, exec)
    if (!obs) continue
    // A delegation label on an own PR is redundant — ownership wins.
    const own = OWN_HEAD_RE.test(obs.head)
    // The narrower grant wins when both labels are present (LLP 0032): review-only forces
    // LLP 0025's no-push mode regardless of the observed push access.
    const reviewOnly = !own && obs.labels.includes(REVIEW_LABEL)
    // foreign ⇔ review-only mode: a `neutral:review` grant, or an adopt fork neutral cannot
    // push. An adoption neutral CAN push is neutral's OWN from first engagement — the adopt
    // label delegated its whole care, terminal included, so it rides the own ladder end-to-end.
    // @ref LLP 0058#adopted-is-own [implements] — foreign = !own ∧ review-only-mode
    const foreign = !own && (reviewOnly || obs.canPush === false)
    // A full-heal adoption riding the own ladder — surfaced for the skill's `[adopt]` tag.
    const adopted = !own && !foreign
    // The automerge opt-in (LLP 0019) never applies to a scavenger's proposal: an
    // autophagy cleanup PR is held for a human even in an automerge repo.
    // @ref LLP 0036#no-automerge [implements]
    const merge = automerge && !obs.head.startsWith(AUTOPHAGY_PREFIX)
    const decision = selectRung({ ...obs, foreign, reviewOnly }, maxReviewRounds, merge)
    const guidance = humanRepliesAfterStuckReport(obs.comments).length
    // Engagement stamp (LLP 0037): observing an adopt-labelled PR IS taking it on, so
    // the first tick that classifies it owes it `neutral:adopted`, set-if-absent.
    // Review-only delegations are narrower and are not adoptions (LLP 0032).
    // @ref LLP 0037#engagement [implements]
    const markAdopted = !own && needsAdoptedLabel(obs.labels)
    out.push({ number: obs.number, head: obs.head, base: obs.base, isDraft: obs.isDraft, headSha: obs.headSha, foreign, reviewOnly, adopted, canPush: obs.canPush !== false, guidance, markAdopted, ...decision })
  }
  // Backstop sweep (LLP 0031, retimed by LLP 0037): a MERGED adoption neutral never saw
  // open still owes its `neutral:adopted` record. With engagement-time stamping above this
  // almost never fires. Emitted as a mechanical terminal action; set-if-absent, so the
  // work-list self-terminates. Own heads are skipped for the same reason as at
  // enumeration: an adopt label on an own PR is redundant — ownership wins.
  // @ref LLP 0037#backstop [implements] — merged ∧ adopt ∧ ¬adopted → mark-adopted
  for (const p of await listMergedAdoptPRs(repo, exec)) {
    if (OWN_HEAD_RE.test(p.headRefName) || !needsAdoptedLabel(p.labels)) continue
    out.push({
      number: p.number, head: p.headRefName, base: '', isDraft: false, headSha: '',
      foreign: false, reviewOnly: false, adopted: true, canPush: true, guidance: 0, markAdopted: true, rung: 'terminal', action: 'mark-adopted',
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
      const tag = p.foreign ? (p.reviewOnly ? '  [review]' : '  [adopt,review-only]') : p.adopted ? '  [adopt]' : ''
      const guidance = p.guidance ? ` guidance=${p.guidance}` : ''
      process.stdout.write(`  #${p.number}  ${p.head}${tag}  rung=${p.rung} action=${p.action}${guidance} — ${p.reason}\n`)
    }
  }
  return 0
}
