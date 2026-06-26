// @ts-check
// Context-size read: how many tokens the orchestrator's own `/loop` session is
// carrying, read from the harness's per-turn `usage` accounting in the session
// transcript — an INDEPENDENT observer (the API's own count), never the model's
// guess at its own size, which would be the self-report LLP 0002 forbids. The pure
// parse is offline-testable against a fixture transcript; only `readContextSize`
// touches the filesystem (reading a file is not shelling out — cf. config.js/llp.js).
// @ref LLP 0013#trigger [implements] — measured, not estimated
// @ref LLP 0002#principle [constrained-by] — the size is ground truth, re-read fresh
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The harness writes each turn's real token `usage` to the transcript. Find it on a
 * record whether it sits at the top level or (the common shape) under `message`.
 * @param {any} record
 * @returns {any|null}
 */
export function usageOf(record) {
  if (!record || typeof record !== 'object') return null
  if (record.usage && typeof record.usage === 'object') return record.usage
  if (record.message && record.message.usage && typeof record.message.usage === 'object') {
    return record.message.usage
  }
  return null
}

/**
 * The carried context size = the token total the *next* turn must read in: the API's
 * own `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` from the
 * LAST record that carries `usage` (output_tokens is this turn's reply, not carried
 * context). Pure function of the JSONL transcript text, so it is offline-testable.
 * Returns 0 when no usage record is present (an unmeasurable transcript reads as
 * "small" → never triggers a recycle, the safe default).
 * @param {string} text  the session transcript, one JSON record per line
 * @returns {number}
 * @ref LLP 0013#trigger [implements] — last usage, summed
 */
export function contextSizeFromTranscript(text) {
  /** @type {any|null} */
  let last = null
  for (const line of String(text || '').split('\n')) {
    const s = line.trim()
    if (!s) continue
    let rec
    try { rec = JSON.parse(s) } catch { continue }  // skip a partial/garbled line
    const u = usageOf(rec)
    if (u) last = u
  }
  if (!last) return 0
  return (Number(last.input_tokens) || 0) +
    (Number(last.cache_creation_input_tokens) || 0) +
    (Number(last.cache_read_input_tokens) || 0)
}

/**
 * The Claude Code project-directory slug for a launch directory: every non-alphanumeric
 * character becomes `-` (so `/Users/phil/workspace/neutral` →
 * `-Users-phil-workspace-neutral`). The transcript lives under this slug.
 * @param {string} dir
 * @returns {string}
 */
export function projectSlug(dir) {
  return String(dir || '').replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * The path to a session's transcript: `~/.claude/projects/<slug>/<id>.jsonl`.
 * @param {string} home    home directory
 * @param {string} cwd     the directory `claude` was launched in (its slug)
 * @param {string} sessionId
 * @returns {string}
 */
export function transcriptPath(home, cwd, sessionId) {
  return join(home, '.claude', 'projects', projectSlug(cwd), `${sessionId}.jsonl`)
}

/**
 * Fallback locator: scan every project directory for `<sessionId>.jsonl`. Used only
 * when the slug-derived path misses (e.g. the session was launched from a different
 * directory than `repo`). Returns null if nothing matches.
 * @param {string} home
 * @param {string} sessionId
 * @returns {string|null}
 */
function findTranscript(home, sessionId) {
  const projects = join(home, '.claude', 'projects')
  const file = `${sessionId}.jsonl`
  let dirs
  try { dirs = readdirSync(projects) } catch { return null }
  for (const d of dirs) {
    const p = join(projects, d, file)
    try { readFileSync(p, 'utf8'); return p } catch { /* not here */ }
  }
  return null
}

/**
 * Read the carried context size of the session whose id is `sessionId` (default: the
 * running process's own `$CLAUDE_CODE_SESSION_ID`, so a sub-agent's transcript can't
 * be mistaken for it — LLP 0013). Returns null when the session cannot be located
 * (no id, no transcript) — the caller treats "unmeasurable" as "do not recycle".
 * @param {{ home?: string, cwd?: string, sessionId?: string, path?: string }} [opts]
 * @returns {number|null}
 * @ref LLP 0013#trigger [implements] — own transcript by session id
 */
export function readContextSize(opts = {}) {
  const home = opts.home || homedir()
  const cwd = opts.cwd || process.cwd()
  const sessionId = opts.sessionId || process.env.CLAUDE_CODE_SESSION_ID
  if (opts.path) {
    try { return contextSizeFromTranscript(readFileSync(opts.path, 'utf8')) } catch { return null }
  }
  if (!sessionId) return null
  const direct = transcriptPath(home, cwd, sessionId)
  try { return contextSizeFromTranscript(readFileSync(direct, 'utf8')) } catch { /* try a scan */ }
  const found = findTranscript(home, sessionId)
  if (!found) return null
  try { return contextSizeFromTranscript(readFileSync(found, 'utf8')) } catch { return null }
}
