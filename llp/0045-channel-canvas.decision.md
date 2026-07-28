# LLP 0045: Channel canvas — a full-replace rendered view of fleet state

**Type:** Decision
**Status:** Accepted
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-28
**Related:** 0002, 0041, 0042, 0044

## Context

The channel's surfaces so far are append-only: messages are events, pins are
the waiting queue (LLP 0044). Nothing shows *current state at a glance* —
what each waiting item actually needs, what is in flight — without opening
threads or asking. Slack's channel canvas (free-plan) is a mutable document
pinned to the channel top, editable by the bot.

## Decision

<a id="canvas-view"></a>**The mayor maintains the channel canvas as a
rendered view of re-derived fleet state, replaced whole each tick.** Full
replace, not section edits: the canvas is a projection of ground truth
(LLP 0002), so the render needs no memory of its previous self and any error
lasts at most one tick. Content: fleet at a glance (loops, last-tick,
`derived at <UTC>` stamp), waiting-on-you (the pin queue with what each item
needs and links), in-flight work, and a short how-to-use-me legend. Canvas
edits notify no one — consistent with event roots being the only unprompted
posts (LLP 0041 §push-pull).

<a id="never-read-back"></a>**The canvas is write-only to the mayor.** It is
a view, never a source: dedupe stays on pins + history keys (LLP 0042/0044),
state stays on git/`gh`/`neutral * --json`. Reading the canvas back as truth
would rebuild the self-reported ledger LLP 0002 exists to kill. The
`derived at` stamp marks staleness honestly — a dead mayor leaves a
visibly old canvas, not a wrong-looking fresh one.

- Scopes: `canvases:write` (+ `groups:read` to look up the existing channel
  canvas id via `conversations.info`). One-time `conversations.canvases.create`
  if the channel has none.

## Consequences

- Mayor skill gains a repaint step after push/inbound; one `canvases.edit`
  per tick.
- Humans may edit the canvas; their edits last at most one tick before the
  repaint — the canvas is the mayor's surface, feedback belongs in messages.
- No bridge or entrypoint change.
