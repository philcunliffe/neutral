# LLP 0046: Readable event roots — header-block titles; the key rides the fallback text

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-28
**Related:** 0041, 0042, 0043, 0044

## Context

LLP 0042 §notification-key put the machine key on the event root's first
line. With pinned roots (LLP 0044) the pin list became the human queue — and
a queue of `[neutral hyparam/hypaware#221 stuck@eedf6ca…]` lines is hard to
read. The key's job is machine findability; it never needed visual primacy.

## Decision

<a id="root-shape"></a>**Event roots post as Block Kit messages**: a
`header` block `<repo-short>#<n> — <title>` (issue/PR title, truncated to
Slack's 150-char header cap; session events use `watchdog — <session>
unhealed`), a `section` with the answer-ready body (state, what it needs,
GitHub link, what a thread reply does), and a small `context` block showing
the key. The pin list and channel then lead with the bold title.

<a id="key-in-text"></a>**The key moves to the `text` fallback field**:
`text` = the header line, newline, the key line. Dedupe and thread-root
resolution match the **exact key string anywhere in a message's `text`**
(`conversations.history`/`pins.list`/`conversations.replies` all return it)
rather than LLP 0042 §notification-key's first-line rule — same
exact-string discipline, one line lower. Phone notifications preview the
title line instead of the raw key.

## Consequences

- LLP 0042 §notification-key gains an `Extended-by: 0046` forward-ref; key
  *formats* are unchanged — only their position in the message.
- LLP 0044's pin sweep matches keys in pinned messages' `text` — unchanged
  mechanics, restated here for the new position.
- Old-format roots (key as line 1) still match the same search; no
  migration.
