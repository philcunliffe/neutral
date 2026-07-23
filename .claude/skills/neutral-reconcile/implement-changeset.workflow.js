export const meta = {
  name: 'implement-changeset',
  description: 'Implement a change set\'s tasks in dependency waves: parallel worktree implementation, then a single serial --no-ff verified merge into the integration branch. "Done" is re-derived from git (the neutral ready CLI) each wave, never self-reported.',
  phases: [
    { title: 'Implement', detail: 'one worktree agent per ready task' },
    { title: 'Merge', detail: 'one serial agent merges + verifies the wave' }
  ]
}

// args: { repo, slug, integration }. The Workflow tool is documented to pass
// `args` through verbatim, but in practice it can arrive either as a parsed
// object or as a JSON string — accept both so the workflow can't silently
// no-op on `undefined` fields.
const _args = typeof args === 'string' ? JSON.parse(args) : (args || {})
const repo = _args.repo
const slug = _args.slug
const integration = _args.integration

const TASK = {
  type: 'object',
  required: ['id', 'branch'],
  properties: {
    id: { type: 'string' },
    branch: { type: 'string' },
    deps: { type: 'array', items: { type: 'string' } },
    brief: { type: 'string' },
    // Planner-rated tier seed (LLP 0022); absent ⇒ mechanical entry.
    complexity: { type: ['integer', 'null'] }
  }
}

const READY_SCHEMA = {
  type: 'object',
  required: ['ready', 'blocked', 'done'],
  properties: {
    ready: { type: 'array', items: TASK },
    blocked: { type: 'array', items: TASK },
    done: { type: 'array', items: TASK }
  }
}

const IMPL_SCHEMA = {
  type: 'object',
  required: ['id', 'testsPass'],
  properties: {
    id: { type: 'string' },
    branch: { type: 'string' },
    prNumber: { type: ['integer', 'null'] },
    headSha: { type: ['string', 'null'] },
    testsPass: { type: 'boolean' },
    notes: { type: 'string' }
  }
}

const MERGE_SCHEMA = {
  type: 'object',
  required: ['merged', 'failed'],
  properties: {
    merged: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, sha: { type: 'string' } } } },
    failed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } } } }
  }
}

// `neutral ready` reads the plan LLP from the WORKING TREE (src/commands/ready.js
// → readLlps), and the plan lives on ${integration}, not the default branch. Rather
// than switch the MAIN checkout — which couples the loop to a clean main checkout and
// breaks the moment a human is editing the repo — read it from a throwaway DETACHED
// worktree on origin/${integration}; that worktree's tree carries the plan.
// @ref LLP 0012#decision [implements] — queue read runs in a worktree, never the main checkout
const DERIVE_READY = `In the repo at ${repo}, read the task queue from a throwaway worktree on the integration branch — never switch the main checkout. \`neutral ready\` reads the plan LLP from the working tree, and the plan for "${slug}" lives on ${integration}. Steps:

1. \`cd ${repo} && git fetch --prune && git worktree prune\`.
2. \`WT=$(mktemp -d) && git worktree add --detach "$WT" origin/${integration}\` — detached, so no branch is checked out and it never conflicts with the main checkout or another worktree.
3. \`cd "$WT" && neutral ready ${slug} --json\` (the global \`neutral\` CLI reads the change set from this worktree's tree).
4. Clean up: \`cd ${repo} && git worktree remove --force "$WT"\`.

Return EXACTLY the parsed JSON it prints — the fields ready, blocked, done, each an array of task objects {id, branch, deps, brief, complexity}. Preserve \`complexity\` verbatim if the CLI emits it (it seeds the model tier, LLP 0022); omit it when absent — never invent a rating. Do not invent or filter tasks; the CLI is ground truth. If the CLI errors (e.g. prints "no plan LLP" to stderr instead of JSON), return ready/blocked/done all empty — the workflow treats an all-empty first read as a hard failure, never as "complete".`

// The task branch must not exist — locally or on origin — until it carries a work
// commit: the done-derivation reads an empty branch at the integration head as a
// trivial ancestor, and one production change set shipped minus a task that way.
// So the worker runs DETACHED and only mints the branch ref at push time.
// @ref LLP 0033#branch-birth [implements] — a branch's existence implies work
function implPrompt(t) {
  return `Implement ONE task of change set "${slug}" in the neutral repo at ${repo}. Isolate your work in your OWN git worktree — never edit the main checkout.

1. \`cd ${repo} && git fetch --prune\`.
2. Create a private DETACHED worktree (idempotent). NEVER create the branch ${t.branch} with worktree add / switch / branch — the branch ref may not exist until it has a work commit (an empty branch at the integration head falsely derives as done):
   - \`WT=$(mktemp -d)\`
   - If \`git rev-parse --verify origin/${t.branch}\` succeeds (work already started), resume from it: \`git worktree add --detach "$WT" origin/${t.branch}\`.
   - Otherwise start fresh off the integration branch: \`git worktree add --detach "$WT" origin/${integration}\`.
   - \`cd "$WT"\` — do ALL work here, on the detached HEAD.
3. Read the change set's plan LLP (\`llp/*-${slug}.plan.md\`) for task ${t.id}, plus the design + request LLPs. Implement EXACTLY task ${t.id}: ${t.brief ? t.brief : '(see the plan)'}. Follow the repo's own conventions (AGENTS.md / CLAUDE.md / CONTRIBUTING if present).
4. Run the repo's checks before committing — DISCOVER them (package.json \`scripts\` such as test/typecheck/lint/build, a Makefile, or the conventions file). Install deps first if this fresh worktree needs them (e.g. \`npm install\`). Run at least the test suite, plus typecheck/lint/build if the repo defines them; ALL must pass. If the repo has no automated tests, say so explicitly in notes.
5. \`git add -A && git commit\` (message ending with a \`Task-Id: ${t.id}\` trailer). Publish the branch only now that it carries the work commit: \`git push origin HEAD:refs/heads/${t.branch}\`.
6. Ensure a PR into ${integration}: \`gh pr list --head ${t.branch}\` (reuse) else \`gh pr create --base ${integration} --head ${t.branch} --title "${t.id}: <summary>" --body "Implements task ${t.id} of ${slug}.\\n\\nTask-Id: ${t.id}"\`.
7. Clean up: \`cd ${repo} && git worktree remove --force "$WT"\`.

Return: id="${t.id}", branch="${t.branch}", prNumber, headSha (\`git rev-parse origin/${t.branch}\`), testsPass (true ONLY if tests AND typecheck passed). If you cannot make them pass, return testsPass=false with short notes — never fake success.`
}

// @ref LLP 0012#decision [implements] — the serial merger runs in its own detached worktree, never the main checkout
function mergePrompt(built) {
  const list = built.map(b => `${b.id} (origin/${b.branch})`).join(', ')
  return `You are the SERIAL merger for change set "${slug}" in the neutral repo at ${repo}. Work in your OWN detached worktree on the integration branch — never the main checkout. Merge these task branches into ${integration} ONE AT A TIME — never in parallel — each fully verified before the next: ${list}. These wave tasks are mutually independent, so order among them does not matter.

Setup: \`cd ${repo} && git fetch --prune && git worktree prune\`, then \`WT=$(mktemp -d) && git worktree add --detach "$WT" origin/${integration} && cd "$WT"\`. Detached HEAD starts at the integration tip; you build the merge commits on it and push them to ${integration} at the end — the main checkout is never touched.

For EACH task branch:
1. \`git merge --no-ff --no-edit origin/<task-branch>\`  (NOT squash, NEVER fast-forward — the done-derivation requires the task tip to survive as a merge commit's second parent, off the integration first-parent chain; LLP 0033).
2. Verify the merge ACTUALLY landed, three ways. If ANY fails, \`git merge --abort\` (or reset), record it under "failed", and skip it — do not push it:
   a. exists: \`git cat-file -t HEAD\` is \`commit\`.
   b. ancestor: \`git merge-base --is-ancestor origin/<task-branch> HEAD\` exits 0.
   c. content: for every file in \`git diff --name-only origin/<task-branch>~1 origin/<task-branch>\` (the task's own changes), \`git diff origin/<task-branch> HEAD -- <file>\` is EMPTY — the task's files now match the task tip on integration.
3. Only then proceed to the next task.

After all verified merges: \`git push origin HEAD:${integration}\`. Then clean up: \`cd ${repo} && git worktree remove --force "$WT"\`.

Return: merged=[{id, sha (the merge commit)}] for each verified-and-pushed task; failed=[{id, reason}] otherwise. Never report a merge you did not verify and push — a fabricated merge corrupts the change set.`
}

// ---- verifier-gated model tiering (LLP 0020) + retry escalation (LLP 0021/0022) ----
// The implementer runs on the MECHANICAL tier by default: a task is small, fully
// specified by the plan, and gated by the verified merge — a weak attempt just fails
// the gate and re-dispatches, never corrupts the change set (LLP 0002). derive-ready
// only relays a CLI (haiku); the serial merger is procedural git (mechanical).
// @ref LLP 0020#decision [implements] — verifier-gated tiers pick the model
const TIERS = ['mechanical', 'worker', 'judgment']
const TIER_MODEL = { mechanical: 'sonnet', worker: 'opus', judgment: 'fable' }
// Effort per tier (LLP 0020). The judgment tier (Fable) runs at `high`, NOT Claude
// Code's `xhigh` default — Fable at `high` still exceeds prior models at their ceiling,
// so capping the priciest tier's thinking is a deliberate, low-risk cost lever. Tiers
// omitted here inherit the session effort. A tunable constant, like TIER_BUDGET.
// @ref LLP 0020#decision [implements] — judgment-tier effort caps at `high`
const TIER_EFFORT = { judgment: 'high' }
// Per-tier attempt budget M (LLP 0021): generous where retries are cheapest, tighter
// as they get dear. A tier retries in place until it exhausts its budget of VERIFIED
// failures, then the task climbs one tier; judgment-tier exhaustion ⇒ neutral:stuck.
// @ref LLP 0021#decision [implements] — a tier's exhausted budget climbs the ladder
const TIER_BUDGET = { mechanical: 5, worker: 3, judgment: 2 }

// Planner rating → entry rung (LLP 0022): 1–3 mechanical, 4 worker, 5 judgment; absent
// ⇒ mechanical. The rating seeds where a task ENTERS the ladder, never what counts as done.
// @ref LLP 0022#decision [implements] — complexity seeds the first-attempt tier
function entryTier(complexity) {
  if (complexity >= 5) return 'judgment'
  if (complexity === 4) return 'worker'
  return 'mechanical'
}
function nextTier(tier) {
  const i = TIERS.indexOf(tier)
  return i >= 0 && i < TIERS.length - 1 ? TIERS[i + 1] : null
}

// ---- the wave loop (deterministic JS; git work is delegated to agents) ----
// The per-change-set fan-out/fan-in (parallel worktree impl, then a serial verified
// merge) that the tick-wide execution model generalizes to every branch-disjoint gap.
// @ref LLP 0010#decision [constrained-by] — the wave loop the per-tick fan-out generalizes

// Per-(task, tier) escalation state, held IN-MEMORY for this run only. Safe because a
// context-autophagy recycle fires solely at idle end-of-tick, never mid-run (LLP 0013),
// so no recycle strands a count; and every `fails` increment below is gated by a fresh
// git re-derivation of "did not land" (LLP 0002) — the tally is ephemeral, each failure
// is ground truth. id -> { tier, fails }.
const attempts = new Map()
const stuck = new Set()
function stateFor(t) {
  let s = attempts.get(t.id)
  if (!s) { s = { tier: entryTier(t.complexity), fails: 0 }; attempts.set(t.id, s) }
  return s
}

let guard = 0
let lastReady = null
let dispatched = [] // task ids dispatched last wave, awaiting outcome attribution

while (guard++ < 64) {
  const r = await agent(DERIVE_READY, { label: `derive-ready:${slug}`, phase: 'Implement', schema: READY_SCHEMA, model: 'haiku' })

  // First-wave failure guard: an all-empty read on the very first wave means
  // derive-ready couldn't see the plan at all (wrong branch checked out, bad
  // args) — that's a failure, not "complete". A real change set with a plan
  // always has at least one task in some bucket, so all-three-empty can only
  // mean the read failed. Surface it loudly instead of returning a false complete.
  if (guard === 1 && (!r || (r.ready.length === 0 && r.blocked.length === 0 && r.done.length === 0))) {
    log(`implement ${slug}: derive-ready saw zero tasks on the first wave — treating as failure, not complete`)
    return { slug, status: 'error', reason: 'derive-ready-empty', done: [], remaining: [] }
  }
  if (!r) { break }
  lastReady = r

  // Attribute last wave's outcomes from git ground truth: a dispatched task now in the
  // done-set landed (clear it); one that did NOT land is a verified failure — charge it
  // to its current tier and, on budget exhaustion, climb a tier (reset) or stick.
  const doneIds = new Set(r.done.map(t => t.id))
  for (const id of dispatched) {
    if (doneIds.has(id)) { attempts.delete(id); continue }
    const s = attempts.get(id)
    if (!s) continue
    if (++s.fails >= TIER_BUDGET[s.tier]) {
      const up = nextTier(s.tier)
      if (up) { log(`implement ${slug}: ${id} exhausted ${s.tier} (${s.fails}); escalating to ${up}`); s.tier = up; s.fails = 0 }
      else { log(`implement ${slug}: ${id} exhausted judgment tier; stuck`); stuck.add(id) }
    }
  }
  dispatched = []

  // Actionable = ready (unblocked, not done) minus tasks that exhausted the ladder.
  const actionable = r.ready.filter(t => !stuck.has(t.id))
  if (actionable.length === 0) break // all done, or all remaining ready tasks are stuck

  log(`implement ${slug}: wave of ${actionable.length} (done=${r.done.length}, stuck=${stuck.size})`)

  const built = (await parallel(actionable.map(t => () => {
    const s = stateFor(t)
    const effort = TIER_EFFORT[s.tier]
    return agent(implPrompt(t), { label: `impl:${t.id}@${s.tier}`, phase: 'Implement', schema: IMPL_SCHEMA, model: TIER_MODEL[s.tier], ...(effort ? { effort } : {}) })
  }))).filter(Boolean)
  dispatched = actionable.map(t => t.id)

  // Merge only the attempts that self-report green; the NEXT derive-ready re-verifies
  // from git which actually landed — the merger's (and impl's) claims are not trusted here.
  const ok = built.filter(b => b.testsPass)
  if (ok.length) await agent(mergePrompt(ok), { label: `merge:${slug}`, phase: 'Merge', schema: MERGE_SCHEMA, model: TIER_MODEL.mechanical })
}

const done = lastReady ? lastReady.done.map(t => t.id) : []
const blocked = lastReady ? lastReady.blocked.map(t => t.id) : []
const remaining = [...new Set([...blocked, ...stuck])]
const status = remaining.length === 0 ? 'complete' : (stuck.size ? 'stuck' : 'partial')
log(`implement ${slug}: loop done — ${done.length} merged, ${remaining.length} remaining (${stuck.size} stuck)`)
return { slug, status, done, remaining, stuck: [...stuck] }
