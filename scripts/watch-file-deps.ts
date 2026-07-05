#!/usr/bin/env bun
/**
 * Runs a dev command and keeps Bun `file:` dependencies fresh.
 *
 * Bun workspaces like vault/ and agents/ consume the monorepo's shared
 * packages (e.g. frontend/packages/ui) as `file:` dependencies, which
 * `bun install` COPIES into node_modules. Editing the package source while
 * the dev server runs leaves that copy stale until the next install.
 *
 * This wrapper, run from the workspace directory:
 *   1. reads package.json and resolves every `file:` dependency path
 *      (dependencies, devDependencies, and overrides),
 *   2. runs `bun install` and starts the given command,
 *   3. watches the `file:` package sources and, on change, re-runs
 *      `bun install` and restarts the command.
 *
 * Usage (from a workspace dir): bun ../scripts/watch-file-deps.ts <command...>
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const workspaceDir = process.cwd()
const command = process.argv.slice(2)
if (command.length === 0) {
  console.error('Usage: bun scripts/watch-file-deps.ts <command...>')
  process.exit(1)
}

function collectFileDependencyPaths(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'))
  const specs: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.overrides,
  }
  const dirs = new Set<string>()
  for (const spec of Object.values(specs)) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue
    const dir = path.resolve(workspaceDir, spec.slice('file:'.length))
    if (fs.existsSync(dir)) dirs.add(dir)
  }
  return [...dirs]
}

/**
 * Watch events at or before this timestamp are dropped: `bun install` itself
 * writes into the file: packages (it materializes their own node_modules), so
 * without a quiet window every install re-triggers the watcher forever.
 */
let quietUntil = 0

function install() {
  const result = Bun.spawnSync(['bun', 'install'], {
    cwd: workspaceDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) {
    console.error('⚠️ watch-file-deps: bun install failed; continuing with existing node_modules')
  }
  quietUntil = Date.now() + 1_000
}

let child: ReturnType<typeof Bun.spawn> | null = null

function startCommand() {
  child = Bun.spawn({
    cmd: command,
    cwd: workspaceDir,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
    onExit(proc, exitCode) {
      // If the CURRENT command dies on its own (not one of our restarts, where
      // the exiting proc is already detached from `child`), give up so the
      // failure is visible instead of silently supervising a corpse.
      if (child === proc) process.exit(exitCode ?? 1)
    },
  })
}

async function stopCommand() {
  const proc = child
  if (!proc) return
  child = null
  proc.kill()
  await proc.exited
}

const IGNORED_PATH_SEGMENTS = ['node_modules', '.git', 'dist', '.DS_Store']

let resyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleResync(reason: string) {
  if (resyncTimer) clearTimeout(resyncTimer)
  resyncTimer = setTimeout(async () => {
    resyncTimer = null
    console.log(`↻ watch-file-deps: ${reason} changed — re-running bun install and restarting`)
    await stopCommand()
    install()
    startCommand()
  }, 300)
}

const watchedDirs = collectFileDependencyPaths()
install()
startCommand()

for (const dir of watchedDirs) {
  const label = path.relative(path.dirname(workspaceDir), dir)
  fs.watch(dir, {recursive: true}, (_event, filename) => {
    if (!filename) return
    if (Date.now() < quietUntil) return
    const parts = filename.split(path.sep)
    if (parts.some((part) => IGNORED_PATH_SEGMENTS.includes(part))) return
    scheduleResync(path.join(label, filename))
  })
  console.log(`👀 watch-file-deps: watching ${label}`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (resyncTimer) clearTimeout(resyncTimer)
    await stopCommand()
    process.exit(0)
  })
}
