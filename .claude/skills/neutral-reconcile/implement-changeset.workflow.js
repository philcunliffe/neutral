export const meta = {
  name: 'implement-changeset',
  description: 'Implement a change set\'s tasks in dependency waves: parallel worktree implementation, then a single serial --no-ff verified merge into the integration branch. "Done" is re-derived from git (the neutral ready CLI) each wave, never self-reported.',
  phases: [
    { title: 'Implement', detail: 'one worktree agent per ready task' },
    { title: 'Merge', detail: 'one serial agent merges + verifies the wave' }
  ]
}

// args: { repo, slug, integration }
const repo = args.repo
const slug = args.slug
const integration = args.integration

const TASK = {
  type: 'object',
  required: ['id', 'branch'],
  properties: {
    id: { type: 'string' },
    branch: { type: 'string' },
    deps: { type: 'array', items: { type: 'string' } },
    brief: { type: 'string' }
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

const DERIVE_READY = `In the neutral repo at ${repo}: run \`git fetch --prune\` then \`node bin/neutral.js ready ${slug} --json\`. Return EXACTLY the parsed JSON it prints — the fields ready, blocked, done, each an array of task objects {id, branch, deps, brief}. Do not invent or filter tasks; the CLI is ground truth.`

function implPrompt(t) {
  return `Implement ONE task of change set "${slug}" in the neutral repo at ${repo}. You are in an isolated git worktree — work only here.

1. \`git fetch --prune\`.
2. Idempotent branch: if \`origin/${t.branch}\` exists, base your work on it (\`git switch -c ${t.branch} origin/${t.branch}\`) and CONTINUE — do NOT start over. Otherwise create it off the integration branch: \`git switch -c ${t.branch} origin/${integration}\`.
3. On this branch read the change set's plan LLP (\`llp/*-${slug}.plan.md\`) for task ${t.id}, plus the design + request LLPs it derives from. Implement EXACTLY task ${t.id}: ${t.brief ? t.brief : '(see the plan)'}. Match the repo's style (AGENTS.md: ESM, no semicolons, JSDoc types).
4. Add/adjust tests. If \`node_modules\` is missing in this worktree, run \`npm install\` first (typecheck needs it). Run \`node --test\` and \`npm run typecheck\`. BOTH must pass.
5. Commit (message ending with a \`Task-Id: ${t.id}\` trailer). \`git push -u origin ${t.branch}\`.
6. Ensure a PR into ${integration}: reuse \`gh pr list --head ${t.branch}\` if present, else \`gh pr create --base ${integration} --head ${t.branch} --title "${t.id}: <summary>" --body "Task-Id: ${t.id}"\`.

Return: id="${t.id}", branch="${t.branch}", prNumber, headSha (\`git rev-parse HEAD\`), testsPass (true ONLY if tests AND typecheck passed). If you cannot make them pass, return testsPass=false with a short notes explaining why — do not fake success.`
}

function mergePrompt(built) {
  const list = built.map(b => `${b.id} (origin/${b.branch})`).join(', ')
  return `You are the SERIAL merger for change set "${slug}" in the neutral repo at ${repo}. Work directly in this repo checkout, which is already on the ${integration} branch (do NOT create a worktree — that branch is checked out here). Merge these task branches into ${integration} ONE AT A TIME — never in parallel — each fully verified before the next: ${list}. These wave tasks are mutually independent, so order among them does not matter.

Setup: \`git fetch --prune\`; confirm you are on ${integration} (\`git switch ${integration}\`) and sync it to the remote (\`git merge --ff-only origin/${integration}\`).

For EACH task branch:
1. \`git merge --no-ff --no-edit origin/<task-branch>\`  (NOT squash — parentage must survive so --is-ancestor stays true).
2. Verify the merge ACTUALLY landed, three ways. If ANY fails, \`git merge --abort\` (or reset), record it under "failed", and skip it — do not push it:
   a. exists: \`git cat-file -t HEAD\` is \`commit\`.
   b. ancestor: \`git merge-base --is-ancestor origin/<task-branch> HEAD\` exits 0.
   c. content: for every file in \`git diff --name-only origin/<task-branch>~1 origin/<task-branch>\` (the task's own changes), \`git diff origin/<task-branch> HEAD -- <file>\` is EMPTY — the task's files now match the task tip on integration.
3. Only then proceed to the next task.

After all verified merges: \`git push origin HEAD:${integration.replace(/^origin\\//, '')}\`.

Return: merged=[{id, sha (the merge commit)}] for each verified-and-pushed task; failed=[{id, reason}] otherwise. Never report a merge you did not verify and push — a fabricated merge corrupts the change set.`
}

// ---- the wave loop (deterministic JS; git work is delegated to agents) ----

let prevDone = -1
let guard = 0
let lastReady = null

while (guard++ < 64) {
  const r = await agent(DERIVE_READY, { label: `derive-ready:${slug}`, phase: 'Implement', schema: READY_SCHEMA })
  if (!r || !r.ready || r.ready.length === 0) { lastReady = r; break }

  // No-progress guard: the done-set must grow each wave, else we are stuck.
  if (r.done.length <= prevDone) {
    log(`implement ${slug}: no progress (done=${r.done.length}); stopping`)
    return { slug, status: 'stuck', reason: 'no-progress', done: r.done.map(t => t.id), stuck: r.ready.map(t => t.id) }
  }
  prevDone = r.done.length
  log(`implement ${slug}: wave of ${r.ready.length} (done=${r.done.length})`)

  const built = (await parallel(r.ready.map(t => () =>
    agent(implPrompt(t), { label: `impl:${t.id}`, phase: 'Implement', isolation: 'worktree', schema: IMPL_SCHEMA })
  ))).filter(Boolean)

  const ok = built.filter(b => b.testsPass)
  if (ok.length === 0) {
    return { slug, status: 'stuck', reason: 'all-impl-failed', done: r.done.map(t => t.id), stuck: r.ready.map(t => t.id) }
  }

  await agent(mergePrompt(ok), { label: `merge:${slug}`, phase: 'Merge', schema: MERGE_SCHEMA })
  // Next iteration's derive-ready re-reads git truth — the merge agent's claims are not trusted here.
}

const done = lastReady ? lastReady.done.map(t => t.id) : []
const remaining = lastReady ? lastReady.blocked.map(t => t.id) : []
log(`implement ${slug}: loop done — ${done.length} merged, ${remaining.length} remaining`)
return { slug, status: remaining.length ? 'partial' : 'complete', done, remaining }
