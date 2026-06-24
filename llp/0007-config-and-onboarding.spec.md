# LLP 0007: Configuration, baseline, and onboarding

**Type:** spec
**Status:** Accepted
**Systems:** Engine
**Author:** Phil
**Date:** 2026-06-24
**Related:** 0003

## Summary

Lets neutral run on **existing repos** — projects with their own layout, and
especially projects already using LLP but without neutral's design/plan/pipeline
layer — instead of assuming neutral's own structure. Three pieces: per-repo
**configuration**, an adoption **baseline**, and a `neutral init` onboarding
command. Plus a rule (`Generated-by`) that keeps neutral from confusing its own
design docs with the project's.

## Configuration

`.neutral/config.json`, merged over `DEFAULT_CONFIG` (`src/config.js`); missing
file → defaults. Tracked (not gitignored). Fields:

- `llpDir` — where the LLP corpus lives (default `llp`).
- `code.exts` / `code.exclude` — source-code discovery for `@ref` coverage. The
  scan walks the **whole repo** (minus excluded dirs and `llpDir`), so an existing
  project's annotations count wherever its code lives — not just `src/bin/test`.
- `roles.request` / `roles.design` — the **type → role** map. A project remaps
  these without touching code (e.g. declare that `plan` is a human doc here, not a
  neutral impl-design).
- `liveStatuses` — statuses that count as live (default `accepted`, `active`).

## Baseline

`.neutral/baseline.json` (tracked) lists request LLPs that already existed / were
built before adoption and must NOT be driven: `{ "grandfathered": [{ "llp": NNNN,
"reason": "...", "date": "..." }] }` (a bare number list is also accepted).
`neutral backlog` excludes them. Prefer real `@ref` annotations on the realizing
code (durable, checkable coverage); the baseline is the escape hatch for what you
can't or won't annotate. Remove an entry to let neutral pick the request up.

## Generated-by

Coverage counts **any** design-type LLP (`isDesignType`) — including the project's
own design/plan docs — so neutral never re-drives something a human design already
addresses. But the pipeline **stages** (impl-design, implement) act only on
designs neutral itself minted, identified by a `**Generated-by:** neutral` header
(`isNeutralDesign`). That separation lets neutral coexist with a project's existing
`plan`/`rfc`/`design` documents without trying to add tasks to them or implement
them.

## neutral init

`neutral init` (`src/commands/init.js`): scaffold `.neutral/config.json` and an
empty `baseline.json` (never overwriting), then **report** what neutral would
drive — the live-request count, covered / in-flight / baselined counts, and the
current backlog. Exit 1 while the backlog is non-empty, 0 when clean. It is the
deterministic onboarding step; an agent-assisted survey that *finds and annotates*
already-built requests is the separate `/neutral-init` skill.

## Onboarding flow

1. `neutral init` → scaffolds config + baseline, prints the backlog.
2. For each already-implemented backlog request: add `@ref LLP NNNN [implements]`
   to the realizing code (preferred), or grandfather it in the baseline.
3. Re-run until the backlog is exactly the new work you want driven.
4. Start `/loop /neutral-reconcile`.
