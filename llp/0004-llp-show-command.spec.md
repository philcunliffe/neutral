# LLP 0004: `neutral llp <number>` command

**Type:** spec
**Status:** Accepted
**Systems:** Engine
**Author:** Phil
**Date:** 2026-06-23
**Related:** 0003

## Summary

Add a read-only CLI subcommand `neutral llp <number>` that prints a single LLP's
metadata and its pipeline status — its type/role, status, systems, the requests
it `@ref`s (if a design), and whether it is covered (if a request).

## Motivation

`status` and `coverage` give corpus-wide views; there is no way to inspect *one*
LLP. The Designer and humans need to look at a single LLP's refs/coverage quickly
without grepping files.

## Design

`neutral llp <number> [--json]`:

- Resolve the LLP by number from the corpus (reuse `readLlps`). Accept padded or
  unpadded input (`4`, `0004`).
- Print: number, title, type (+ role: request / design / background), status,
  systems, author, date, path.
- If it is a **design**: list the request numbers it `@ref`s (covers).
- If it is a **request**: show whether it is covered, and by which design(s) or
  `code` — reuse `coverage()`.
- `--json` emits the structured record (the `Llp` plus a `coveredBy` field).
- Unknown number → stderr message + exit 2.

This is purely additive: a new `src/commands/llp.js` plus one dispatch line in
`bin/neutral.js`. It touches no core engine module.

## Acceptance

- New `src/commands/llp.js`; one `case 'llp'` dispatch line in `bin/neutral.js`;
  usage text updated.
- A test (`test/llp-command.test.js` or similar) that resolves a known number and
  asserts the printed/JSON fields, and that an unknown number returns exit 2.
- `node --test` stays green; `tsc --noEmit` stays clean.

## References

- [LLP 0003](0003-coverage-and-change-sets.spec.md) — the engine data model this reuses.
