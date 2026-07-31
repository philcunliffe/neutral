# LLP 0055: Canvas lookup scans the channel's tabs

**Type:** Decision
**Status:** Active
**Systems:** Engine
**Author:** Phil / Claude
**Date:** 2026-07-31
**Related:** 0039, 0042, 0045

## Context

The mayor's repaint (LLP 0045) located the channel canvas via
`conversations.info` at `.channel.properties.canvas.file_id`, creating one
if absent. Against the real channel that key is **never present** — the
channel's canvases appear only as `type: "canvas"` entries in
`.channel.properties.tabs[]`. And `conversations.canvases.create` does not
fail when the channel already has a canvas; it silently adds another tab.

The two behaviors compound: every fresh mayor session (each restart or
recycle) looked up nothing, "created once", and minted a new canvas. A
long-running mayor masked it by carrying the id in session context.
Observed in production 2026-07-31: three duplicate canvases, one per
restart (19:17, 19:27, 19:47 UTC), beside the original from 2026-07-30.

## Decision

The lookup resolves the canvas id as: `.channel.properties.canvas.file_id`
**falling back to the first `type == "canvas"` tab's** `data.file_id`.
`conversations.canvases.create` runs only when both come up empty — and the
skill records that create is not idempotent, so "found nothing" must mean
the tabs scan ran, not that a key was missing.

Duplicates are cleaned with `canvases.delete`, keeping the original; the
full-replace repaint (LLP 0045) makes the survivor current again within one
tick, so deletion loses nothing.

## Alternatives rejected

- **Trust `properties.canvas` and treat tabs as new-API noise.** The key
  simply is not returned for this channel; waiting for Slack to restore it
  leaves canvas-per-restart in place.
- **Remember the canvas id in a state file.** LLP 0042 R3 — the mayor keeps
  no state file; the fix belongs in the read, not in a ledger.

## Consequences

- Restarts and recycles repaint the same canvas; a new canvas can appear
  only when the channel truly has none.
- LLP 0045's scope note gains a forward-ref here.
