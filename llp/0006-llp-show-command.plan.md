# LLP 0006: Plan — `neutral llp <number>` command

**Type:** plan
**Status:** Active
**Systems:** Engine
**Author:** Phil
**Date:** 2026-06-23
**Generated-by:** neutral
**Related:** 0005

## Summary

Implementation plan for [LLP 0005](0005-llp-show-command.design.md) — the
`neutral llp <number>` command. The work is one self-contained, additive task.

## Tasks
- id: T1  branch: task/llp-show-command/T1  deps: []  -- add src/commands/llp.js, the dispatch+usage line in bin/neutral.js, and a unit test

## Task detail

### T1 — `neutral llp <number>`

- Create `src/commands/llp.js` exporting `llpCommand(repo, args)` per LLP 0005's
  design: resolve the LLP by number (padded/unpadded), print metadata + role +
  coverage, support `--json`, unknown number → stderr + exit 2.
- Add `case 'llp': return llpCommand(repo, rest)` and a usage line to `bin/neutral.js`.
- Add `test/llp-command.test.js`: a known number prints/serializes the expected
  fields; an unknown number returns exit 2.
- Follow AGENTS.md style (ESM, no semicolons, JSDoc types). Reuse `readLlps`,
  `coverage`, `readCodeRefs`; do not modify their logic.
- Acceptance: `node --test` green, `tsc --noEmit` clean, `node bin/neutral.js llp 4`
  prints LLP 0004's details.

## References

- @ref LLP 0004 — the request.
- @ref LLP 0005 — the design this plan implements.
