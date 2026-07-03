---
name: neutral-init
description: Onboard a repo onto neutral end-to-end — preflight repo status, run `neutral init` (config + baseline + CLAUDE.md convention), ref-check the LLP corpus formatting, survey the backlog to find and annotate already-built requests, and create the neutral:fix / neutral:stuck GitHub labels. Use when setting up neutral on a repo, when `neutral init` output points at the /neutral-init skill, or before starting `/loop /neutral-reconcile` for the first time.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, Skill
---

# neutral-init

Agent-assisted onboarding — the full flow of LLP 0007 §Onboarding, of which the
deterministic `neutral init` command is step one. The repo being onboarded is the
current working directory. Every step is idempotent; re-running the skill is safe.

## 1. Preflight — observe, decide nothing

- `git rev-parse --show-toplevel` — must be a git repo; note the branch. A dirty
  tree is fine (init only adds files) but report it.
- Locate the LLP corpus: `llpDir` from `.neutral/config.json` if present, else
  `llp/`. **No corpus → stop** and suggest `/llp-adopt` first; neutral drives LLP
  requests, so there is nothing to onboard without one.
- `git remote -v` + `gh auth status` — needed only for the label step (§5). If
  there is no GitHub remote or `gh` auth, do everything else and report that step
  as skipped, with the commands for the human to run later.
- The CLI: `neutral` on PATH, else `node <neutral checkout>/bin/neutral.js`.

## 2. Scaffold — run `neutral init`

Run it and show the output. It scaffolds `.neutral/config.json` +
`.neutral/baseline.json` (never overwriting) and seeds the LLP-immutability
convention block into `CLAUDE.md` (following a symlink, e.g. to `AGENTS.md`).
**Exit 1 means the backlog is non-empty — expected on a brownfield repo, not an
error.** That backlog is §4's work list.

## 3. Format — the corpus must parse clean

Run the `ref-check` skill over the corpus. Fix what it flags — these are
mechanical/editorial, so allowed even on Accepted/Active docs (immutability
governs decided content, not formatting):

- metadata headers that fail to parse (`**Type:**`, `**Status:**`, `**Systems:**`)
- filename type not matching `**Type:**`
- `@ref` targets that don't resolve (LLP numbers, anchors, repo paths)
- duplicate LLP numbers
- `[inferred]` claims surviving in an Accepted/Active doc

Re-run until it exits 0. Never rewrite what a doc decided or required to make a
check pass — if a fix would change meaning, surface it to the human instead.

## 4. Survey — the backlog must be exactly the new work

`neutral backlog --json`. For each request, search the codebase for realizing
code (fan out one Agent per request when the backlog is large). Three outcomes:

- **Built, realizing code found** → annotate it, directly above the construct
  with no blank line between (real, checkable coverage — always prefer this):
  ```js
  // @ref LLP NNNN [implements] — <short gloss>
  ```
- **Built, but nothing sensibly annotatable** → grandfather it in
  `.neutral/baseline.json` with an honest reason:
  `{ "grandfathered": [{ "llp": NNNN, "reason": "…", "date": "YYYY-MM-DD" }] }`
- **Not built, or unsure** → leave it in the backlog. Never grandfather just to
  make the count go down — an uncertain request stays visible for the human to
  rule on (LLP 0002: coverage is real annotations, never a claim).

Re-run `neutral init` after each round until the backlog lists exactly the work
the human wants neutral to drive.

## 5. Labels — the maintenance-family authorization gates

The maintenance reconcilers act only on labelled artifacts (LLP 0009; the label
names are constants in neutral's `src/config.js`). Create both, idempotently
(`--force` updates in place if they exist):

```sh
gh label create "neutral:fix"   --force --color 1D76DB \
  --description "delegated to neutral for a fix attempt"
gh label create "neutral:stuck" --force --color D93F0B \
  --description "neutral could not complete this — a human must look"
```

## 6. Verify + hand off

- `.neutral/config.json` and `.neutral/baseline.json` must be **tracked**:
  `git check-ignore` must fail for both; if either is ignored, fix `.gitignore`.
- Final `neutral init` run — report its exit code and output verbatim.
- Leave all changes uncommitted and end with a summary: files created/edited,
  annotations added (file:line per request), grandfathered entries with reasons,
  labels created, and the residual backlog. Offer the commit; never push.
- Point at the next step: backlog empty → start `/loop /neutral-reconcile`;
  backlog non-empty → the human reviews the residual requests first.
