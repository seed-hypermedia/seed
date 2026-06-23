/**
 * Thin typed wrapper around `seed-cli`. Every invocation is recorded in
 * `seed-cli.jsonl` of the current audit run with full argv, exit code,
 * and (truncated) stdout/stderr.
 *
 * Hard denylist: certain subcommands are refused unconditionally to keep
 * the rules doc from being able to weaken security. Writes always force
 * `--key <agent-key>` and `-s <SEED_SERVER>`.
 */

import {spawn} from 'node:child_process'
import type {AgentConfig} from './config.js'
import type {AuditRun} from './audit.js'
import type {Redactor} from './redact.js'

const STDOUT_TRUNCATE_BYTES = 64 * 1024

/**
 * Hardcoded denylist of `<command>:<subcommand>` pairs that are NEVER
 * permitted — even if the rules doc tries to enable them. Read-only key
 * operations (`key list`, `key show`, `key default`, `key derive`) are
 * allowed because the wrapper itself needs them at boot to resolve the
 * agent's accountId.
 */
const DENY_VERB_PAIRS = new Set([
  // Anything that mutates the keystore.
  'key:generate',
  'key:import',
  'key:remove',
  'key:rename',
  // Anything that mutates the capability graph.
  'capability:create',
  // Account profile mutations are owner-only.
  'account:set',
  'account:remove',
])

export class SeedCliError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export type SeedCliResult = {
  exitCode: number
  stdout: string
  stderr: string
  parsedJson?: unknown
}

export class SeedCli {
  constructor(
    private readonly config: AgentConfig,
    private readonly redactor: Redactor,
    private readonly audit?: AuditRun,
  ) {}

  /** Read-only commands. No --key injection. */
  async runRead(args: string[]): Promise<SeedCliResult> {
    return this.run(args, {requireKey: false})
  }

  /**
   * Write commands. Forces `--key <agent>` and `-s <server>`. Refuses anything
   * in the deny list before spawning.
   */
  async runWrite(args: string[]): Promise<SeedCliResult> {
    return this.run(args, {requireKey: true})
  }

  private async run(args: string[], opts: {requireKey: boolean}): Promise<SeedCliResult> {
    if (args.length === 0) {
      throw new SeedCliError('EMPTY_ARGS', 'seed-cli invoked with no arguments')
    }
    const pair = `${args[0] ?? ''}:${args[1] ?? ''}`
    if (DENY_VERB_PAIRS.has(pair)) {
      throw new SeedCliError('DENIED_SUBCOMMAND', `seed-cli "${pair}" is denied by hardcoded policy`)
    }
    const finalArgs: string[] = ['-s', this.config.seedServer, ...args]
    if (opts.requireKey && !args.includes('--key') && !args.includes('-k')) {
      finalArgs.push('--key', this.config.keyName)
    }
    const tsStart = new Date().toISOString()
    const t0 = Date.now()
    const {exitCode, stdout, stderr} = await spawnCapture(this.config.cliPath, finalArgs)
    const tsEnd = new Date().toISOString()
    const latencyMs = Date.now() - t0
    if (this.audit) {
      this.audit.seedCli({
        ts_start: tsStart,
        ts_end: tsEnd,
        latency_ms: latencyMs,
        argv: [this.config.cliPath, ...finalArgs],
        exit_code: exitCode,
        stdout: this.redactor(truncate(stdout)),
        stderr: this.redactor(truncate(stderr)),
      })
    }
    let parsedJson: unknown
    if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
      try {
        parsedJson = JSON.parse(stdout)
      } catch {
        /* not JSON, ignore */
      }
    }
    return {exitCode, stdout, stderr, parsedJson}
  }
}

function truncate(s: string): string {
  if (Buffer.byteLength(s) <= STDOUT_TRUNCATE_BYTES) return s
  return s.slice(0, STDOUT_TRUNCATE_BYTES) + `\n…[truncated]`
}

function spawnCapture(cmd: string, args: string[]): Promise<{exitCode: number; stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env},
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({exitCode: typeof code === 'number' ? code : -1, stdout, stderr})
    })
  })
}

// Test helper: split out the deny-list check so unit tests can exercise it
// without a real CLI binary on disk.
export function isDenied(command: string, subcommand: string): boolean {
  return DENY_VERB_PAIRS.has(`${command}:${subcommand}`)
}
