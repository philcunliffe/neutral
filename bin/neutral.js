#!/usr/bin/env node
// @ts-check
// neutral CLI — the deterministic observe/query surface the reconcile loop calls.
import { statusCommand } from '../src/commands/status.js'
import { readyCommand } from '../src/commands/ready.js'
import { coverageCommand } from '../src/commands/coverage.js'
import { backlogCommand } from '../src/commands/backlog.js'
import { llpCommand } from '../src/commands/llp.js'

const USAGE = `neutral — declarative reconcilers for the LLP -> PR pipeline

usage:
  neutral status [--json]        corpus by stage, coverage gap, designs
  neutral coverage [--json]      working-tree coverage as an exit code (0 covered, 1 not)
  neutral backlog [--json]       requests needing a design, excluding in-flight ones
  neutral ready <slug> [--json]  the unblocked-open task queue for a change set
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
    case 'status': return statusCommand(repo, rest)
    case 'coverage': return coverageCommand(repo, rest)
    case 'backlog': return backlogCommand(repo, rest)
    case 'ready': return readyCommand(repo, rest)
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
