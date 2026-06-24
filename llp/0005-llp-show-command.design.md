# LLP 0005: Design — `neutral llp <number>` command

**Type:** design
**Status:** Active
**Systems:** Engine
**Author:** Phil
**Date:** 2026-06-23
**Generated-by:** neutral
**Related:** 0004

## Covers

@ref LLP 0004 — the read-only `neutral llp <number>` inspection command.

## Summary

Add a `neutral llp <number>` subcommand that resolves one LLP by number and prints
its metadata plus its pipeline role and coverage, reusing the existing engine
(`readLlps`, `coverage`, `readCodeRefs`). Purely additive — a new command module
and one dispatch line; no existing engine module's logic changes.

## Technical design

New module `src/commands/llp.js` exporting `llpCommand(repo, args)`:

- Parse `<number>` from args (accept padded or unpadded: `4`, `0004`); detect a
  `--json` flag. Missing/invalid number → stderr usage + exit 2.
- `readLlps(repo)`; find the LLP whose `number` matches. Unknown number → stderr
  message + exit 2.
- Role: `isRequestType` → "request", `isDesignType` → "design", else "background".
- Text output: number, title, `type` + role, status, systems, author, date, path.
  - If a **design**: list the covered request numbers (its `refs`).
  - If a **request**: compute `coverage(readLlps(repo), readCodeRefs(repo))` and
    show its `coveredBy` (design ids and/or `code`), or `uncovered`.
- `--json`: emit the `Llp` record plus `role` and `coveredBy` fields.

Dispatch: add `case 'llp': return llpCommand(repo, rest)` to `bin/neutral.js` and a
usage line. Reuse helpers from `src/llp.js`, `src/coverage.js`, `src/refs.js`.

## Implementation shape

A single self-contained unit of work (the command module + dispatch line + usage +
a unit test). No internal dependencies — one task.

## Verification

- `node --test` green; a new test asserts a known number's printed/JSON fields and
  that an unknown number returns exit 2.
- `tsc --noEmit` clean.
- `node bin/neutral.js llp 4` prints LLP 0004's details and its coverage state.

## References

- @ref LLP 0004 — the request this design covers.
- [LLP 0003](0003-coverage-and-change-sets.spec.md) — the engine data model reused.
