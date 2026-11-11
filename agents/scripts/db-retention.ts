#!/usr/bin/env bun
/**
 * Runs one retention pass (src/db-retention.ts) against an agents database, for the one-off shrink
 * of a database that grew before retention existed. Run it with the server STOPPED: unlike the
 * server's periodic task it is unthrottled and drops durable stores of any size.
 *
 *   bun scripts/db-retention.ts <agents.sqlite> [--report] [--idle-days 14] [--journal-days 30] [--mib-per-sec 0]
 *
 * `--report` changes nothing and prints what would go. In the container, where only the bundled
 * server exists, build it to one file first:
 *
 *   bun build agents/scripts/db-retention.ts --target=bun --outfile=/tmp/db-retention.js
 *   docker cp /tmp/db-retention.js agents-stable:/tmp/
 *   docker exec agents-stable timeout 3h bun /tmp/db-retention.js /data/agents.sqlite --report
 */

import {Database} from 'bun:sqlite'
import * as retention from '@/db-retention'

const args = process.argv.slice(2)
const dbPath = args.find((arg) => !arg.startsWith('--'))
if (!dbPath) {
  console.error(
    'usage: bun db-retention.ts <agents.sqlite> [--report] [--idle-days D] [--journal-days D] [--mib-per-sec N]',
  )
  process.exit(2)
}
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = Number(args[index + 1])
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid --${name}`)
  return value
}

const db = new Database(dbPath, {readwrite: true})
db.run('PRAGMA journal_mode = WAL')
db.run('PRAGMA busy_timeout = 5000')
const policy: retention.RetentionPolicy = {
  ...retention.DEFAULT_RETENTION_POLICY,
  mode: args.includes('--report') ? 'report' : 'on',
  durableIdleMs: option('idle-days', 14) * 86_400_000,
  journalAgeMs: option('journal-days', 30) * 86_400_000,
  bytesPerSecond: option('mib-per-sec', 0) * 1_048_576,
  maxStoreBytes: Number.POSITIVE_INFINITY,
}
let stopped = false
process.once('SIGINT', () => (stopped = true))
process.once('SIGTERM', () => (stopped = true))
const result = await retention.runRetentionPass(db, policy, {stopped: () => stopped})
console.log(JSON.stringify(result, null, 2))
if (policy.mode === 'on') db.run('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
