// @ts-check
// `neutral enqueue <pr-number> <expected-head-sha>` — execute one already-decided
// merge-queue admission with a double head guard. The rung decision remains in
// prhealth.js; this command only makes its GitHub side effect deterministic.
// @ref LLP 0061 [implements]
import { run } from '../git.js'

/**
 * @param {string} repo
 * @param {number} number
 * @param {string} expectedHeadOid
 * @param {typeof run} [exec]
 * @returns {Promise<{number: number, headSha: string, id: string, position: number, state: string}>}
 */
export async function enqueuePR(repo, number, expectedHeadOid, exec = run) {
  const raw = await exec('gh', ['pr', 'view', String(number), '--json', 'id,headRefOid'], repo)
  const pr = JSON.parse(raw)
  const actual = String(pr.headRefOid || '')
  if (!pr.id) throw new Error(`PR #${number} has no GraphQL node id`)
  if (!expectedHeadOid || actual !== expectedHeadOid) {
    throw new Error(`PR #${number} head changed: expected ${expectedHeadOid || '(missing)'}, observed ${actual || '(missing)'}`)
  }

  const query = 'mutation($id:ID!,$oid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$oid}){mergeQueueEntry{id position state}}}'
  const queued = await exec('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `id=${pr.id}`, '-F', `oid=${expectedHeadOid}`], repo)
  const entry = JSON.parse(queued)?.data?.enqueuePullRequest?.mergeQueueEntry
  if (!entry?.id) throw new Error(`GitHub did not return a merge queue entry for PR #${number}`)
  return {
    number,
    headSha: expectedHeadOid,
    id: String(entry.id),
    position: Number(entry.position || 0),
    state: String(entry.state || 'UNKNOWN')
  }
}

/**
 * @param {string} repo
 * @param {string[]} args
 * @param {typeof run} [exec]
 * @returns {Promise<number>}
 */
export async function enqueueCommand(repo, args, exec = run) {
  const number = Number(args[0])
  const headSha = args[1] || ''
  if (!Number.isInteger(number) || number <= 0 || !headSha) {
    process.stderr.write('usage: neutral enqueue <pr-number> <expected-head-sha>\n')
    return 2
  }
  const entry = await enqueuePR(repo, number, headSha, exec)
  if (args.includes('--json')) process.stdout.write(JSON.stringify(entry, null, 2) + '\n')
  else process.stdout.write(`enqueued PR #${entry.number} at position ${entry.position} state=${entry.state}\n`)
  return 0
}
