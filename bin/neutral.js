#!/usr/bin/env node
// @ts-check
// neutral CLI — the deterministic observe/query surface the reconcile loop calls.
import { statusCommand } from '../src/commands/status.js'
import { readyCommand } from '../src/commands/ready.js'
import { coverageCommand } from '../src/commands/coverage.js'
import { backlogCommand } from '../src/commands/backlog.js'
import { implementableCommand } from '../src/commands/implementable.js'
import { llpCommand } from '../src/commands/llp.js'
import { initCommand } from '../src/commands/init.js'
import { prsCommand } from '../src/commands/prs.js'
import { issuesCommand } from '../src/commands/issues.js'
import { idleCommand } from '../src/commands/idle.js'
import { startCommand } from '../src/commands/start.js'

const USAGE = `neutral — declarative reconcilers for the LLP -> PR pipeline

usage:
  neutral start                  launch the orchestrator loop in its tmux pane (LLP 0013)
  neutral init                   scaffold .neutral/ config + baseline; report the backlog
  neutral status [--json]        corpus by stage, coverage gap, designs
  neutral coverage [--json]      working-tree coverage as an exit code (0 covered, 1 not)
  neutral backlog [--json]       requests needing a design (excl. in-flight + baselined)
  neutral implementable [--json] Accepted designs merged to target, owed an implementation (LLP 0003)
  neutral ready <slug> [--json]  the unblocked-open task queue for a change set
  neutral prs [--json]           in-scope open PRs with the reconcilePR rung to act on
  neutral issues [--json]        open neutral:fix issues with their fix-attempt state
  neutral idle [--json]          is the tick idle, and should it recycle context (LLP 0013)
  neutral llp <number> [--json]  inspect one LLP: metadata, role, coverage
  neutral help                   this message
`

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  const [cmd = 'status', ...rest] = argv
  const repo = process.cwd()

  switch (cmd) {
    case 'start': return startCommand(repo, rest)
    case 'init': return initCommand(repo, rest)
    case 'status': return statusCommand(repo, rest)
    case 'coverage': return coverageCommand(repo, rest)
    case 'backlog': return backlogCommand(repo, rest)
    case 'implementable': return implementableCommand(repo, rest)
    case 'ready': return readyCommand(repo, rest)
    case 'prs': return prsCommand(repo, rest)
    case 'issues': return issuesCommand(repo, rest)
    case 'idle': return idleCommand(repo, rest)
    case 'llp': return llpCommand(repo, rest)
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE)
      return 0
    default:
      process.stderr.write(`neutral: unknown command "${cmd}"\n\n${USAGE}`)
      return 2
  }
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    process.stderr.write(`neutral: ${err && err.stack ? err.stack : err}\n`)
    process.exit(1)
  }
)
