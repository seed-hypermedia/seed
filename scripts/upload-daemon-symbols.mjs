#!/usr/bin/env node
/**
 * Upload Go daemon (`seed-daemon`) debug info to Sentry so native crash stacks
 * land symbolicated. Driven from CI after the daemon binary is built and after
 * any platform-specific dSYM/PDB files are produced.
 *
 * Usage:
 *   SENTRY_AUTH_TOKEN=... \
 *   SENTRY_ORG=mintter \
 *   SENTRY_PROJECT=seed-electron \
 *   node scripts/upload-daemon-symbols.mjs <path-to-binary-or-dir> [<more paths...>]
 *
 * Skips the upload (with a warning) when SENTRY_AUTH_TOKEN is unset, so local
 * builds don't fail.
 */

import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Usage: upload-daemon-symbols.mjs <path> [<path>...]')
  process.exit(1)
}

if (!process.env.SENTRY_AUTH_TOKEN) {
  console.warn('[sentry] SENTRY_AUTH_TOKEN not set; skipping daemon symbol upload.')
  process.exit(0)
}

const org = process.env.SENTRY_ORG || 'mintter'
const project = process.env.SENTRY_PROJECT || 'seed-electron'

const cliArgs = [
  '--package=@sentry/cli@2.42.5',
  '--yes',
  'sentry-cli',
  'debug-files',
  'upload',
  '--org',
  org,
  '--project',
  project,
  '--include-sources',
  '--log-level=info',
]

for (const p of args) {
  const abs = resolve(p)
  if (!existsSync(abs)) {
    console.warn(`[sentry] path not found, skipping: ${abs}`)
    continue
  }
  cliArgs.push(abs)
}

const result = spawnSync('npx', cliArgs, {stdio: 'inherit', env: process.env})
if (result.status !== 0) {
  console.error('[sentry] debug-files upload failed with status', result.status)
  process.exit(result.status ?? 1)
}
