---
name: neutral-reconcile
description: Run one reconcile tick of neutral — observe git/GitHub ground truth across both reconciler families (LLP→PR pipeline + PR/issue maintenance), fan out every branch-disjoint gap in parallel, fan in serial verified merges, and re-derive "done" from git. Holds every result for a human; never merges unless the repo opts in (`automerge`, LLP 0019). Idempotent and safe to re-run. Use when running `/loop /neutral-reconcile` to drive a repo toward neutral state, or to run one tick by hand.
allowed-tools: Bash, Read, Write, Edit, Agent, Skill, Workflow
---

# neutral-reconcile

One **tick** of the neutral reconciler. A tick observes ground truth across every
reconciler family, **fans out all branch-disjoint gaps in parallel**, **fans in**
serial verified merges, re-derives "done" from git/GitHub, and returns. Re-running
is always safe — state is derived, not stored. Driven by `/loop /neutral-reconcile`.

**This loop is autonomous — there is no user at the terminal.** Never call
`AskUserQuestion`, never end a tick on a question, never wait for in-terminal
confirmation — the loop may run unattended for days, and a terminal question wedges
it while every other gap sits idle. Questions have exactly **one** channel: the
artifact's own thread. Label the PR/issue `neutral:stuck` and put the concrete
question in the marker-signed **stuck report** (LLP 0026); the human answers by
replying on the thread, and the unstick predicate (LLP 0027) feeds the reply back in
on a later tick. This applies to every worker you dispatch too — pass it down: a
worker that needs a human decision returns "stick it with this question", it does
not ask.

The goal is **neutral state** (LLP 0008): every gap neutral can close *autonomously*
is closed — no uncovered request LLP, no `neutral:fix` issue without a fix attempt,
no in-scope PR left unmergeable / failing / unreviewed. Neutral stops at the
boundary of what only a human may do: **merging is the one act neutral never
performs** — unless the repo owner moved that boundary with `automerge: true`
in `.neutral/config.json` (LLP 0019), in which case the terminal rung merges
instead of holding. By default it drives every artifact to *held, green,
reviewed* and waits.

## The one rule — ground truth, never self-report (LLP 0002)

**Never trust a claim of "done" — re-derive it from the world.** The independent
observer's verdict re-read fresh is authoritative; the acting agent's prose is only
a *hint to verify*:

- **Merged?** `git merge-base --is-ancestor <branch> <integration>` — a verified ancestor.
- **Covered?** a real `@ref LLP NNNN` in a design (or code), not a "designed" flag.
- **Mergeable? / Green?** GitHub's *own* computation, read against the **current head
  SHA** (`gh pr view --json mergeable,statusCheckRollup`). A green check from a prior
  push is **stale** and does not count.
- **Bug fixed?** a regression test that **failed** pre-fix now **passes** in the
  committed tree (CI green on the fix PR is the authority, not the agent's local run).
- **Not yet observable ≠ false.** A `PENDING` check or `UNKNOWN` mergeability means
  **wait for the next tick**, never "broken" — acting on it storms work that was
  about to pass.

The deterministic Node CLI (`neutral …`) and git/`gh` are the authority; agents do
work, the tick verifies it.

## Each tick

1. **Fetch + prune.** `git fetch --prune` (without it a teammate's push and the
   human's merge are invisible and the loop looks wedged), then `git worktree prune`
   to reap worktrees a failed worker left behind. **The main checkout is read-only**
   — every git mutation this tick happens in a self-created worktree (LLP 0012), so a
   dirty working tree or a human editing the repo never blocks the loop.
2. **Observe every gap** (the loop's eyes — all CLI, no LLM judgement):
   - **Pipeline family**
     - `neutral backlog --json` → live requests needing a design (Designer).
     - `neutral implementable --json` → `Accepted` designs merged to the target with
       no `integration/<slug>` yet — **design-first** work owed an implementation
       (Impl-designer's *seed* path; LLP 0016). A human did the Designer step by hand.
     - a `design` LLP without a `plan` (Impl-designer's *plan* path): neutral-minted
       designs on `integration/*` branches, plus any change set just seeded from an
       `implementable` design.
     - change sets with a `plan` but unmerged tasks (`neutral ready <slug> --json`).
   - **Maintenance family**
     - `neutral prs --json` → every in-scope open PR (own `integration/*` and
       `fix/issue-*`) with the **single rung action** `reconcilePR` should take this
       tick (`merge-base | resolve-conflict | fix-ci | review | triage | ready-hold |
       stuck-report | unstick | wait | held`). The CLI decides the rung from observed
       state — you act, you do not re-decide. A non-zero `guidance` field means the
       thread carries human replies to a stuck report (LLP 0027) — feed them to any
       worker you dispatch for that PR.
     - `neutral issues --json` → every open `neutral:fix` issue with its fix-attempt
       state (`needs-fix | attempt-exists | stuck`).
3. **Fan out** every **branch-disjoint** gap concurrently (LLP 0010) — implement a
   change set, resolve a conflict on PR X, fix CI on PR Y, review PR Z, mint a
   design, write the fix for issue I. Each worker is blind to the others and works in
   its **own** `git worktree` (never the main checkout).
4. **Fan in** — *you*, the orchestrator, perform the serial verified merges and
   **re-derive "done" from git/`gh`** before anything counts. A worker's report is a
   hint; the re-derivation is the conclusion.
5. **Emit one log line per gap acted on:**
   `tick: family=<pipeline|maintenance> target=<slug|pr#N|issue#N> action=<…> detail=<…>`.
6. **End of tick — recycle or schedule (LLP 0013).** Run `neutral idle --json`. If
   `recycle` is `false`, **return** and let the loop schedule the next tick
   (`ScheduleWakeup`). If `recycle` is `true` (idle ∧ context > T), perform the
   **context-autophagy respawn** (below) **instead of** scheduling — it is the tick's
   last act.

### Disjointness — the fan-out lock (LLP 0010)

**Disjointness key = the target branch / PR.** At most **one** worker per
`integration/<slug>` (or per PR) per tick — LLP 0003's
one-merge-flow-per-integration-branch lock, generalized. Different branches run in
parallel; same-branch work serializes. This is what stops PR-health's base-merge on
`integration/X` racing the Implementer's task-merge on the same branch. When the
Workflow concurrency cap is hit, **priority is only queue order** (held-PR
dependents → review → implement → issue-fix → design); it no longer selects a single
action.

### Context autophagy — recycle on idle (LLP 0013)

On a genuinely **idle** tick (neutral reached, nothing in flight) whose measured
context has grown past the threshold **T**, the orchestrator recycles its own context
by tearing the session down and re-entering fresh — there is no in-session clear and
`ScheduleWakeup` re-enters the *same* growing context (LLP 0010 §Context recycle).
**Both conditions are ground truth**, read once by `neutral idle --json`, never the
model's own judgement (LLP 0002):

- `idle` — backlog empty ∧ every in-scope PR action `held` ∧ no `needs-fix` issue.
  **`wait` is not idle** — a running check is in flight; recycling mid-run would
  strand it. The CLI returns the `blockers` holding the tick open if not.
- `context > T` — the API's own per-turn `usage` summed from *this* session's
  transcript (keyed by `$CLAUDE_CODE_SESSION_ID`), not a self-estimate. Unmeasurable
  context reads as "do not recycle".

`recycle` is `true` only when **both** hold. Then, **after** fan-in and after the
tick's log lines (R2 — nothing may follow this destructive act):

- **In tmux** (`$TMUX` set): emit one final log line
  `tick: family=autophagy action=recycle detail=context=<N> threshold=<T>`, then
  **respawn the pane** — the tick's last act:
  ```sh
  tmux respawn-pane -k "claude --model 'claude-opus-4-8[1m]' '/loop /neutral-reconcile'"
  ```
  **Pin the model** to the 1M-context Opus 4.8 (the worker tier, matching `neutral
  start` — LLP 0020): an unpinned respawn silently reverts the fresh orchestrator to
  the machine's session default, which may be a different tier or a 200K window too
  small for the autophagy threshold T (LLP 0013). Single-quote the `[1m]` token so `sh`
  doesn't glob the brackets. No `-t`: tmux defaults to the **current pane**
  (`$TMUX_PANE`), so the respawn targets the very pane the loop runs in — independent of
  the per-repo session name (LLP 0014).
  `respawn-pane -k` atomically kills this session and starts a fresh `/loop` in the
  **same pane** — the pane is the one-orchestrator mutex, so no successor can overlap
  the predecessor (R4, LLP 0010). The fresh session re-`observe`s every gap from
  git/the API; **no handoff state** crosses the boundary (LLP 0002).
- **Not in tmux** (`$TMUX` unset — R6): context autophagy is **unavailable**. Do
  **not** respawn and **never** attempt a `setsid`/detached self-relaunch (the
  two-orchestrator hazard, LLP 0010). Return normally; harness auto-summarization
  handles context growth as the fallback.

A respawn resets the transcript to baseline, so autophagy **self-rate-limits** (R5):
it cannot fire again until context regrows past T (tens of idle ticks).

## Model tiering — the verifier picks the model (LLP 0020–0022)

Dispatch is tiered by **what checks the output**, not by how hard the input looks
(LLP 0020). Because "done" is re-derived from git/CI and never self-reported, a weak
model's failure just re-opens the gap — so cheap models run wherever a verifier gates
the result, and the strongest is reserved for judgement no machine re-checks. When you
dispatch a worker below, pass the tier's model as the sub-agent's `model`:

- **Judgment tier — `fable`, at `high` effort.** Output no verifier re-derives, where
  an error propagates: the **Designer**, the **Impl-designer**, and the **triage** rung.
  Run Fable at **`high`**, not Claude Code's `xhigh` default — Fable at `high` still
  exceeds prior models at their ceiling, so it's a low-risk cost lever on the priciest
  tier. The implement Workflow enforces this via `agent({ effort: 'high' })`; the **Agent
  tool has no per-call `effort` override**, so the Designer/Impl-designer/triage inherit
  the **session** effort — run the orchestrator loop at `high` if you want them capped
  there too.
- **Worker tier — `opus` (Opus 4.8).** Bounded work behind a hard gate: **conflict
  resolution**, **issue-fix**, the Claude half of **review**, and the **orchestrator
  itself** (pinned at launch — LLP 0020; the tick is mechanical, the CLI decides every
  rung).
- **Mechanical tier — `sonnet`, or `haiku` for pure CLI relay.** Fully verifier-gated
  execution: **task implementation** and its **serial merger**, **fix-ci**,
  **review-fix** agents, and **derive-ready** (haiku). The implement Workflow already
  sets these per `agent()` call.

**Retry escalation (LLP 0021/0022).** A task's *first* attempt starts at the tier its
planner-rated `complexity` seeds (1–3 mechanical, 4 worker, 5 judgment; absent ⇒
mechanical). It retries in place until it exhausts that tier's budget of **verified**
failures — mechanical 5, worker 3, judgment 2 — then climbs one tier; judgment-tier
exhaustion is `neutral:stuck`. Every LLP 0002 gate applies identically at every tier:
escalation changes *which model retries*, never *what counts as done*. The implement
Workflow's wave loop owns this ladder end-to-end; the other rungs below take a single
tier per their heading.

## Fan-out worker: Designer (pipeline)  — judgment tier (`fable`)

Goal: every live request is `@ref`'d by a `design` LLP. Plan the **whole** backlog
up front and mint **all** change sets in one pass (do not dribble one group per tick).

1. `neutral backlog --json` — the full backlog (already excludes code-, in-flight-,
   and baseline-covered requests). Empty → no Designer work.
2. **Plan the partition** (one reasoning pass, whole backlog in view):
   `[{ slug, covers: [<request #s>], dependsOn: [<other slugs in this plan>] }, …]`.
   Each request in exactly one group; group what's implementable together (shared
   `Systems:`, dense `Related:`, a natural feature boundary); order with `dependsOn`
   so B follows A when B builds on A's code; keep groups independent where you can.
   `log` the plan (one line per group).
3. **Mint every change set** in topological order, sequential LLP numbers across the
   batch (start at one past the highest LLP number across `<DEFAULT>` and all
   `integration/*`; `git ls-tree -r --name-only <ref> llp/`). For each, in its **own
   detached worktree** (never the main checkout, LLP 0012):
   - `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/<DEFAULT> && cd "$WT"`
   - mint `llp/NNNN-<slug>.design.md`: `**Type:** design`, `**Status:** Active`,
     `**Systems:**`, `**Generated-by:** neutral`, `**Depends-on:** <predecessors>`
     (omit if none); body = the technical design with one `@ref LLP NNNN — <gloss>`
     per covered request (this satisfies coverage).
   - `git add llp/ && git commit && git push origin HEAD:integration/<slug>` (creates
     the remote branch); then `cd <repo> && git worktree remove --force "$WT"`.
4. **Verify:** `neutral backlog` is now **empty**. Never commit a design to the target branch.

## Fan-out worker: Impl-designer (pipeline)  — judgment tier (`fable`)

Goal: every implementable `design` LLP has a `plan` LLP on its `integration/<slug>`
branch. A design is implementable two ways: **neutral-minted** (already on
`integration/<slug>` from the Designer), or **design-first** (LLP 0016) — a human merged
a `design` to the target at `**Status:** Accepted`, surfaced by `neutral implementable`.

**Design-first only — seed the branch first** (idempotent; skip if it exists): in a
detached worktree off the target, create `integration/<slug>` so the change set has a
branch (the design rides along from the target) —
`WT=$(mktemp -d) && git worktree add --detach "$WT" origin/<DEFAULT> && cd "$WT" && git push origin HEAD:integration/<slug> && cd <repo> && git worktree remove --force "$WT"`.
The implementation later flips the design `Accepted → Active` (a lifecycle move, not a
content edit — immutability holds) so the merged change set reads as shipped (LLP 0016
§Shipped is Active). Then proceed below for both kinds:

1. In its **own detached worktree** (never the main checkout, LLP 0012):
   `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/integration/<slug> && cd "$WT"`.
2. Mint `llp/NNNN-<slug>.plan.md` (`**Type:** plan`, `**Status:** Active`,
   `**Related:** <design #>`, `**Generated-by:** neutral`). Refine into small,
   independently-mergeable tasks; write a `## Tasks` block in the parser's format:
   ```
   ## Tasks
   - id: T1  branch: task/<slug>/T1  deps: []        complexity: 2  -- <brief>
   - id: T2  branch: task/<slug>/T2  deps: [T1]      complexity: 5  -- <brief>
   ```
   Encode real code dependencies in `deps`. **Rate each task's `complexity` 1–5**
   (LLP 0022) — your judgement, made here with the whole design in view, seeds the
   first implementation attempt's model tier: **1–3** a mechanical task (Sonnet),
   **4** needs the worker tier (Opus 4.8), **5** needs judgement (Fable). Rate for
   the *hardest* part of the task; be honest, not generous — the rating only seeds
   the entry rung and a verified failure still escalates (LLP 0021), so under-rating
   costs one climbing attempt, over-rating overpays. Omit `complexity` only when you
   truly can't tell; absent reads as mechanical.
3. **Commit + push:** `git add llp/ && git commit && git push origin HEAD:integration/<slug>`.
4. **Verify** from the worktree: `neutral ready <slug> --json` parses and lists the
   tasks. Then `cd <repo> && git worktree remove --force "$WT"`.

## Fan-out worker: Implement (pipeline, the wave-loop Workflow)  — tiered per task

Goal: every task is a verified-merged commit on `integration/<slug>`. The Workflow
sets each agent's model itself (LLP 0020–0022): `derive-ready` on `haiku`, the serial
merger on `sonnet`, and each task's implementer on its current ladder tier — entering
at the planner's `complexity` rating and escalating on verified failure. You pass no
model here; you only re-verify and label what it returns stuck.

1. **Prune** stale worktrees: `git worktree prune`.
2. Ensure `integration/<slug>` is **current**: if its `Depends-on:` predecessors are
   now merged to target (`changeSetMergedToTarget`), bring the updated target in
   first — in a **detached worktree**, never the main checkout (LLP 0012):
   `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/integration/<slug> && cd "$WT" && git merge --no-edit origin/<DEFAULT> && git push origin HEAD:integration/<slug>`,
   then `cd <repo> && git worktree remove --force "$WT"`. A change set whose
   predecessors are NOT merged is blocked — skip this tick.
3. **Launch the implement-changeset Workflow** (the wave loop lives in its JS).
   Invoke the **Workflow tool** with `scriptPath` = `<this skill's base
   directory>/implement-changeset.workflow.js` and `args: { repo: <abs path from
   git rev-parse --show-toplevel>, slug: "<slug>", integration: "integration/<slug>" }`.
4. **Re-verify every merge from git** after it returns — the report is a hint.
   `neutral ready <slug> --json`: each claimed-done task must be a real ancestor of
   `integration/<slug>`. Re-dispatch anything claimed-but-not-landed (idempotent).
   The wave loop escalates a failing task up the model ladder in place and only gives
   up once the **judgment tier** exhausts its budget (LLP 0021) — it returns those
   task ids in `stuck`. For each, label its PR `neutral:stuck` and post the **stuck
   report** (LLP 0026 — see the format below) in the same act, surface it — do not
   re-dispatch a stuck task this tick.

Then the change set's PR is driven by **reconcilePR** below (the shared spine).

## Fan-out worker: reconcilePR — PR health (shared spine, LLP 0009)

Goal for **every in-scope open PR** (own `integration/*` change sets AND
`fix/issue-*` fixes): **mergeable ∧ green ∧ reviewed**, then **held for a human**.
The rungs are strictly ordered and `reconcilePR` climbs **one rung per PR per tick,
then re-observes** — any push moves the head SHA, so every downstream fact is
recomputed next tick. Distinct PRs advance in **parallel** (branch-disjoint).

Do NOT re-derive the rung in prose. Read it from `neutral prs --json` — the `action`
field per PR is the deterministic decision (`src/prhealth.js`). Act on it:

**The `neutral:approved` label on own PRs (LLP 0030).** For every **own** (non-`foreign`)
PR each tick, sync the `neutral:approved` label to the decision's **`approved`** field —
**mechanical, no agent, idempotent**: read the PR's current labels first, then
`gh pr edit N --add-label neutral:approved` iff `approved` is `true` and the label is
absent, or `gh pr edit N --remove-label neutral:approved` iff `approved` is falsy and the
label is present (do nothing when already in sync). `approved` is `true` only at the
reviewed-clean terminal (`ready-hold` / `held` / `merge`), so the label is added there and
**stripped the instant the PR regresses** (any heal/review/stuck/triage rung omits the
field) — it tracks the current reviewed-clean head and never goes stale. This runs
alongside the rung action below; it is **not** itself a rung and never blocks one. Foreign
PRs keep the verdict-label mechanism (`approve` / `request-changes`) unchanged. Create the
`neutral:approved` label in the target repo once if it does not exist (`gh label create`).

**The stuck report (LLP 0026).** *Whatever* sets `neutral:stuck` on a PR — the triage
rung, a conflict back-off, wave-loop exhaustion — must post the report comment **in
the same act** as the label (`gh pr comment N --body …`). It is one full comment,
written for the human who has to act:

- **First line, exactly:** `<!-- neutral-stuck: <current head SHA> -->` — the marker
  the monitoring keys on. **Every comment neutral posts must carry a
  `<!-- neutral-… -->` marker** (neutral comments through the owner's own account, so
  the marker — not the author — is what distinguishes it from the human; an unmarked
  neutral comment would read as a human reply and falsely unstick the PR).
- **What neutral was doing** — the rung/action, the change set or issue, the head.
- **Why it cannot proceed** — the specific blocker(s): each unresolved finding, the
  conflict backed off, the decision fork — with links.
- **What it needs from you** — the concrete question(s), with options where they exist.
- **How to unstick** — tell the human: *reply with a comment on this PR (or push to
  the branch); neutral monitors this thread and will re-engage with your guidance on
  its next tick.*

**Guidance feeding (LLP 0027).** When `neutral prs` reports `guidance > 0` for a PR,
read the thread (`gh pr view N --json comments`) and include the stuck report and
every later human comment in the prompt of **any** worker dispatched for that PR —
the human's reply is the input, not just a wake-up. This applies on the ticks *after*
an unstick too (the label is gone but the guidance stands until a new report
supersedes it). If the worker still cannot proceed, it re-sticks with a **fresh**
report — never reuse the old one; the latest report is the baseline that decides
which replies are new.

- **First, ensure the PR exists.** A change set with merged tasks but no PR needs a
  **draft** PR `integration/<slug> → DEFAULT` (`gh pr list --head …` else
  `gh pr create --draft --base DEFAULT --head …`), body ending `Change-Set: <slug>`.
  A `fix/issue-*` PR is created by the issue-fix worker (below) with `Fixes #N`.
- **`merge-base`** (rung 1, `BEHIND` — stale, no conflict): **mechanical, no agent**,
  in a **detached worktree** (never the main checkout, LLP 0012) — `<pr-branch>` is
  `integration/<slug>` or the `fix/issue-*` branch:
  `WT=$(mktemp -d) && git worktree add --detach "$WT" origin/<pr-branch> && cd "$WT" && git merge --no-edit origin/<DEFAULT> && git push origin HEAD:<pr-branch>`,
  then `cd <repo> && git worktree remove --force "$WT"`. Re-observes next tick.
- **`resolve-conflict`** (rung 1, `DIRTY` — the **highest-blast-radius** action):
  dispatch ONE agent (**worker tier — `opus`**, LLP 0020) in its own worktree. It
  resolves the conflict and must get a
  **green local test run BEFORE pushing**. The local run is a *precaution only*; CI
  (the green rung) is the authoritative gate after the push (LLP 0002 — the resolving
  agent does not grade its own merge). If it cannot get a clean resolution + green
  local run, it **backs off (no push)** and the PR is labelled `neutral:stuck` +
  given the stuck report (LLP 0026, format above — which files conflict, what the
  two sides want, what call the human must make).
- **`fix-ci`** (rung 2, `FAILURE`): dispatch ONE agent (**mechanical tier —
  `sonnet`**, LLP 0020 — usually a lint/dep/flaky fix, and CI re-observes next tick)
  to fix from the failing logs (`gh run view --log-failed`), in its own worktree,
  push. Re-observes next tick.
- **`review`** (rung 3, head not yet reviewed): dispatch the review in its **own
  worktree** (never the main checkout, LLP 0012) — `dual-review` does a `gh pr
  checkout --detach` *in place* and **refuses on a dirty tree**, so it must run in a
  clean, isolated checkout. Run the review — `dual-review` when `command -v codex`
  succeeds, else `code-review` — on the PR number; the review itself is **worker-tier**
  work (LLP 0020 — Codex, when present, is the independent second family). **Capture
  the head SHA you reviewed** (the `headSha` from `neutral prs`). For each actionable
  finding, dispatch a fix (**mechanical tier — `sonnet`**; a fix is positively verified
  against the tree, so a weak attempt can't slip through — and round 2's fixes climb a
  tier per LLP 0021) and **positively verify** it landed (the named file/symbol
  changed in the committed tree vs pre-fix HEAD — a green suite is not proof a fix
  landed; LLP 0002 §Reviewed). Then **record the round as ONE marker-signed comment
  on the PR** (LLP 0028) — the comment IS the record; the PR body is no longer
  edited for review state. First line, exactly:
  `<!-- neutral-review: <the head SHA you reviewed> <clean|findings> -->` —
  `clean` when the review found nothing actionable, `findings` when it found any
  (fixed or not; LLP 0029) — followed by the full review a human can act on: the
  verdict, each finding with severity and evidence (file:line), and what was fixed.
  **Post the record whatever the outcome** — a round that leaves no comment did not
  happen (`reviewRounds` counts these comments), and an unrecorded blocked round
  would re-review the same head forever. No separate `gh pr edit`: the comment is
  the single act. If you fixed findings the head has since moved, so the next tick
  re-reviews the new head (round 2); if the review was `clean` the record covers
  the current head and the PR is terminal. The CLI bounds this to **N=2** rounds
  before it returns `triage`.
- **`triage`** (rung 3, review rounds exhausted at an unreviewed head): the fix-loop hit
  `maxReviewRounds` with findings still open. **Before parking the PR, judge whether it can
  ship safely** (LLP 0017). Dispatch ONE agent (**judgment tier — `fable`**, LLP 0020 —
  a mis-classified blocker ships a production defect; this call is not machine-checkable)
  in its **own worktree** to re-read every
  **unresolved** finding from the last review and classify each as a **true blocker** —
  could cause a *production* defect (wrong behaviour, data loss, a security hole, a crash, a
  perf regression past budget) — or a **preference** (style, naming, a test nicety, a
  non-behavioural refactor). Then, **all-or-nothing**:
  - **Every residual finding is non-blocking** → the PR can merge safely. **Idempotently**
    open a follow-up issue (skip if an open `neutral:fix` follow-up for this PR already
    exists): `gh issue create` titled `Follow-up: deferred review findings from PR #N`,
    labelled `neutral:fix`, body enumerating each deferred finding **+ a backlink to PR #N**.
    Comment on the PR linking the issue. Then append `<!-- neutral-triage: <the head SHA> #M -->`
    to the PR body (`gh pr edit N --body …`) — **last**, so a partial failure re-triages
    rather than skipping. The marker satisfies the reviewed rung; **next tick** the PR is
    terminal → `ready-hold` flips it `gh pr ready` and HOLDS for a human to merge. The
    deferred findings ride the issue-fix reconciler (the invariants compose — LLP 0008).
  - **Any residual finding is a true blocker** → it cannot merge safely. Label the PR
    `neutral:stuck` and post the **stuck report** (LLP 0026, format above): why each
    blocker is a production risk, the non-blockers too (the human sees the whole PR),
    and what decision or input unsticks it. Surface it — do not split, do not churn.
  Skip entirely if a `neutral-triage` marker already covers the head (already triaged).
- **`stuck-report`** (labelled `neutral:stuck`, but no marker-signed report in the
  thread — a worker crashed between label and comment, a hand-labelled PR, or a PR
  stuck before LLP 0026): dispatch ONE agent (**worker tier — `opus`**) to read the
  PR (diff, checks, review history, thread) and post the stuck report (format
  above). Idempotent — the marker is the presence predicate; next tick reads `held`.
- **`unstick`** (labelled `neutral:stuck`, and a human replied after the latest
  stuck report — or pushed since it): **mechanical, no agent.**
  `gh pr edit N --remove-label neutral:stuck`, then acknowledge so the human knows
  they were heard: `gh pr comment N --body '<!-- neutral-ack -->\nRe-engaging with
  your guidance — <one line naming what was taken from the reply>.'` (marker-signed,
  so the ack itself never reads as a human reply). Label removal is tidy-up to match
  the predicate, not the trigger (LLP 0027). Next tick re-runs the real rung at the
  current head; `guidance` stays non-zero, so the dispatched worker gets the replies.
- **`ready-hold`** (terminal — mergeable ∧ green ∧ reviewed, still a draft):
  `gh pr ready <N>`, ensure `neutral:approved` is set (the label sync above; `approved`
  is `true` here — LLP 0030), and **HOLD**. Never merge; never `gh pr ready` a PR neutral
  does not own.
- **`merge`** (terminal, only when the repo opted in with `automerge: true` —
  LLP 0019): `gh pr ready <N>` if still a draft, then `gh pr merge <N> --squash`
  (squash-only-at-the-final-PR, as for a human merge). No `--delete-branch` — the
  Handoff stage owns cleanup. The CLI emits this action *only* when all three rungs
  hold at the current head and the PR is not `neutral:stuck`; if the merge is
  refused (branch protection), leave it — next tick re-observes. **Verify like a
  human merge:** next tick the design LLP on `origin/<DEFAULT>` /
  `gh pr view --json state` = `MERGED` is the ground truth, not gh's exit code.
- **`wait`** / **`held`**: do nothing this tick.

### Adopted (foreign) PRs — `neutral:adopt` / `neutral:review` (LLP 0025/0032)

A PR carrying `neutral:adopt` or `neutral:review` that neutral did **not** author is in scope
by the maintainer's label (the authorization, exactly like `neutral:fix`; LLP 0024). The two
labels differ only in the width of the grant: **`neutral:adopt` = full heal**, **`neutral:review`
= review-only** — review the head and post the verdict, but **never push to the branch**, even
when push access exists (LLP 0032). `neutral prs` tags the PR `[adopt]`, `[adopt,review-only]`
(adopt, but neutral cannot push to the fork), or `[review]` (review-only by label — when both
labels are present the narrower `neutral:review` wins; a grant never widens implicitly), and
drives the **same rung ladder**, with two differences: heal rungs are gated on push access, and
the terminal is a **verdict label**, never a ready-flip or merge — readying/merging a
contributor's PR is the maintainer's call (LLP 0000 §Autonomy).

**Healing an adopted PR is the job, not an overreach.** The maintainer put `neutral:adopt`
on the PR *precisely to delegate its care* — the label is single-key, full-heal
authorization (LLP 0024); there is no additional consent to seek and no reason to hold
back because the code is a contributor's. When `neutral prs` reports the PR pushable
(`[adopt]`), fixing it — merge-basing, resolving conflicts, repairing CI, fixing review
findings — and **pushing those commits to the contributor's branch** is the expected
behaviour, exactly as for an own PR. Do not voluntarily downgrade to review-only, do not
substitute a comment for a fix you could push, and do not skip the PR out of caution: a
labelled, pushable, unhealed adopted PR is a **gap the tick failed to close**. The only
things that limit healing are the CLI's own signals — `[adopt,review-only]` (no push
access), `[review]` (the maintainer asked for review-only, LLP 0032), or the rung action
itself. The autonomy boundary sits *only* at the terminal: ready/merge stays the
maintainer's.

- **Full-heal** (`[adopt]`, neutral can push): `merge-base` / `resolve-conflict` / `fix-ci` /
  `review` behave exactly as for an own PR — resolve/fix and **push to the fork's head branch**
  (the contributor left maintainer-edits on). At the review cap the action is **`request-changes`**,
  not `triage` (the code is the contributor's — hand residual findings back, never defer to a
  `neutral:fix` follow-up).
- **Review-only** (`[adopt,review-only]` — a cross-repo fork with maintainer-edits off — or
  `[review]` — the maintainer asked for review-only with `neutral:review`, LLP 0032; both
  behave identically): neutral must not push, so an unmet **`request-changes`** heal rung
  means *the contributor* must rebase / resolve / fix CI. **`review`** still runs (it needs
  no push): review the head, and because you cannot push a fix, post the verdict
  **directly** — `approve` if clean, else `request-changes` — recording both the
  marker-signed review-record comment (`<!-- neutral-review: <sha> <clean|findings> -->`
  first line; LLP 0028/0029) and the verdict marker. For a `[review]` PR the no-push rule is
  the maintainer's explicit instruction — do not "helpfully" push even though access exists.
- **`approve`** (terminal — mergeable ∧ green ∧ reviewed): `gh pr edit <N> --add-label
  neutral:approved --remove-label neutral:changes-requested`, comment the verdict, and append
  `<!-- neutral-verdict: <the head SHA> approved -->` to the body **last** — then HOLD for the
  maintainer to merge. Never `gh pr merge` / `gh pr ready` a contributor's PR.
- **`request-changes`**: `gh pr edit <N> --add-label neutral:changes-requested --remove-label
  neutral:approved`, post it as `gh pr review <N> --request-changes` with the blocking findings
  (or the rebase-/fix-CI ask), and append `<!-- neutral-verdict: <the head SHA> changes-requested -->`
  to the body **last**, so a partial failure re-runs rather than skipping. A contributor push
  moves the head and re-opens the ladder; an unchanged head reads as `held` (the verdict marker
  covers it).
- **`mark-adopted`** (a **merged** adoption missing its completion record — LLP 0031):
  **mechanical, no agent**: `gh pr edit <N> --add-label neutral:adopted`. `neutral prs` emits
  this for a PR that was merged while carrying `neutral:adopt` but does not yet carry
  `neutral:adopted` — the label is the completion record, a cache of merged ∧ adopt-labelled
  (LLP 0002), add-only because a merged head can never move again. Keep `neutral:adopt` in
  place (the maintainer's authorization record — LLP 0031 rejects the swap). Create the
  `neutral:adopted` label in the target repo once if it does not exist (`gh label create`).

## Fan-out worker: Issue-fix (maintenance, LLP 0009)  — worker tier (`opus`)

Goal: every open `neutral:fix` issue has a **fix attempt** — a `Fixes #N` PR, or a
documented `neutral:stuck`. The reconciler's whole job is **issue → fix PR**;
`reconcilePR` then carries that PR to held + green + reviewed (the two invariants
compose). The label is the **authorization** — no `neutral:fix`, no action.

For each issue `neutral issues --json` reports as **`needs-fix`** (skip
`attempt-exists` — resume via `reconcilePR`; skip `stuck` — a human must look):

1. **Idempotent intake** (the CLI already checked): `fix/issue-N` branch off the
   default branch (resume `origin/fix/issue-N` if it exists).
2. Dispatch ONE fix agent (**worker tier — `opus`**, LLP 0020) in its own worktree
   under the **diagnose/bugfix discipline** — *reproduce → root-cause → fix*, where
   **reproduce = a regression test that FAILS on current code and PASSES after the
   fix**. The agent works out
   how to run the tests in context (no configured command); its local run is advisory.
3. **Ground-truth gate (LLP 0002):** no reproducing failing-then-passing test ⇒ no
   credible fix ⇒ **no PR**. Label the issue `neutral:stuck` and surface it. Never
   open a PR on an unproven fix.
4. With a proven fix: open the PR `fix/issue-N → DEFAULT`, body ending **`Fixes #N`**
   (GitHub closes the issue *on merge*; neutral never closes it). Hand off to
   `reconcilePR`.
5. **Escalate, don't force:** if the "bug" is really a missing feature or an
   architectural change, file a **request LLP** instead — it re-enters the pipeline
   family, not the maintenance family.

## Fan-in: serial verified merges + re-derive

After the parallel workers return, **you** do the non-parallel, verified parts:
the task→integration merges (inside the implement Workflow's serial merger), and
re-deriving every "done" from git/`gh` (`neutral ready`, `git merge-base
--is-ancestor`, `gh pr view --json`). A worker that failed leaves its gap open;
next tick re-observes and re-dispatches (idempotent — partial failure is normal).

## Stage: Handoff (after a human merges)

A predecessor change set is **merged** only when, after `git fetch`, its `design`
LLP is present on `origin/<DEFAULT>` (`changeSetMergedToTarget` — robust to squash
vs merge commit, unlike a body trailer). Corroborate with `gh pr view <N> --json
state` = `MERGED` if known. Only then may a change set whose `Depends-on:` named it
begin. Delete the merged integration branch (local + `git push origin --delete`).

## Invariants

- **One `/loop` session per repo.** Parallelism is *intra-tick* via sub-agents;
  exactly one orchestrator touches the repo (LLP 0010). Two reconcilers racing the
  same repo is unsafe — nothing in git prevents it, so don't.
- **No user at the terminal — ever.** Never `AskUserQuestion`, never end a tick
  waiting on in-terminal input. Every question for a human goes through
  `neutral:stuck` + the marker-signed stuck report on the artifact's thread
  (LLP 0026/0027), where it blocks only that one artifact instead of the loop.
- **Never merge — unless the CLI's rung says `merge`.** Merging is the one
  irreversible act, a human's by default; drive to held + green + reviewed and
  stop. The single exception is the repo opting in via `automerge: true`
  (LLP 0019), and even then only the `neutral prs` action decides — never merge
  on your own judgement.
- **Never push to the target branch.** All design/plan/code/fixes land via a held PR.
- **Never `gh pr ready` or merge a PR neutral does not own — and never touch an
  unlabelled foreign PR.** Own PRs (`integration/*`, `fix/issue-*`) terminate in
  `ready-hold`/`merge` and carry `neutral:approved` at that reviewed-clean terminal, synced
  head-accurately to the decision's `approved` field (LLP 0030 — added at the terminal,
  stripped on any regression); an **adopted** foreign PR (`neutral:adopt`, LLP 0025)
  terminates in a **verdict label** (`neutral:approved` / `neutral:changes-requested`) and is
  never readied or merged by neutral. This boundary is about *ready/merge and unlabelled
  PRs* — it is **not** a reason to avoid healing: pushing fixes to a labelled adopted PR that
  `neutral prs` reports pushable (tagged `[adopt]`, not `[adopt,review-only]`) is the
  expected full-heal mode (LLP 0024), and skipping it leaves a gap open. In review-only
  mode neutral only reviews and posts the verdict.
- **Branch-disjoint fan-out.** At most one worker per `integration/<slug>` / PR per tick.
- **Head-SHA keying.** "Green" and "reviewed" only count for the *current* head SHA;
  re-read it each tick.
- **PENDING / UNKNOWN = wait, not act.** A running check or computing mergeability is
  not failure.
- **Self-created worktrees; the main checkout is read-only.** The Workflow runtime's
  built-in `isolation:'worktree'` fails in this repo, so every worker runs `git
  worktree add` itself — and so does the orchestrator for its *own* git mutations
  (queue read, serial merger, `merge-base` rung, design/plan minting, review). The
  orchestrator never `git switch`es or writes the main checkout, so a dirty working
  tree or a human editing the repo never blocks a tick (LLP 0012). Orchestrator
  worktrees are **detached** (`git worktree add --detach origin/<branch>`, push via
  `HEAD:<branch>`) so they never collide with a branch checked out elsewhere.
- **Squash only at the final PR.** Task→integration merges are `--no-ff` (so
  `--is-ancestor` holds). The `integration → target` PR is the only squash.
- **Idempotent dispatch.** Before creating any branch, check it exists; if so, resume.

## Quick start (run one tick by hand)

```sh
git fetch --prune
neutral backlog --json        # pipeline: any request needing a design?
neutral implementable --json  # pipeline: any Accepted design merged to target, owed code? (LLP 0016)
neutral prs --json            # maintenance: each in-scope PR's next rung action
neutral issues --json         # maintenance: each neutral:fix issue's state
# then fan out the branch-disjoint workers above and re-derive from git.
neutral idle --json        # end of tick: idle ∧ context>T ? recycle the pane (LLP 0013)
```
