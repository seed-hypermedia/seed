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

/**
 * Watch a directory tree with one NON-recursive watcher per directory.
 *
 * `fs.watch({recursive: true})` on Linux walks the whole subtree itself,
 * including node_modules — where pnpm leaves dangling symlinks
 * (node_modules/.bin/esbuild etc.) and `bun install` rewrites entries while
 * we watch. Both surface as an ENOENT on the watcher, which with a recursive
 * watcher means re-arming the entire tree and hitting the same path again,
 * forever. Walking manually lets us skip IGNORED_PATH_SEGMENTS entirely and
 * confine any error to the one directory that vanished.
 */
const watchers = new Map<string, fs.FSWatcher>()

function watchTree(root: string, label: string) {
  watchDir(root, root, label)
}

function watchDir(root: string, dir: string, label: string) {
  if (watchers.has(dir)) return
  let watcher: fs.FSWatcher
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (!filename) return
      const full = path.join(dir, filename)
      // A new subdirectory (e.g. a freshly created component folder) needs
      // its own watcher; do this regardless of the quiet window so we don't
      // miss it, but skip ignored names so node_modules never gets watched.
      if (!IGNORED_PATH_SEGMENTS.includes(filename)) {
        try {
          if (fs.statSync(full).isDirectory()) watchDir(root, full, label)
        } catch {
          // Vanished between event and stat (or a dangling symlink); if it
          // was a watched dir its own watcher's error handler cleans up.
        }
      }
      if (Date.now() < quietUntil) return
      const rel = path.relative(root, full)
      if (rel.split(path.sep).some((part) => IGNORED_PATH_SEGMENTS.includes(part))) return
      scheduleResync(path.join(label, rel))
    })
  } catch (err) {
    // Unwatchable entry (dangling symlink, permission) — skip just this one.
    const code = (err as NodeJS.ErrnoException).code ?? (err as Error).message
    console.warn(`⚠️ watch-file-deps: cannot watch ${path.join(label, path.relative(root, dir))} (${code}); skipping`)
    return
  }
  watchers.set(dir, watcher)
  watcher.on('error', (err) => {
    // The directory itself went away (or was replaced). Drop it; if it comes
    // back, the parent's watcher sees the create event and re-adds it. Only
    // the tree root gets re-armed, since nothing above it is watching.
    const code = (err as NodeJS.ErrnoException).code ?? err.message
    watcher.close()
    watchers.delete(dir)
    if (dir === root) {
      console.warn(`⚠️ watch-file-deps: watcher error on ${label} (${code}); rewatching`)
      setTimeout(() => watchTree(root, label), 1_000)
    }
  })

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true})
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue // isDirectory() is false for symlinks: never follow them
    if (IGNORED_PATH_SEGMENTS.includes(entry.name)) continue
    watchDir(root, path.join(dir, entry.name), label)
  }
}

for (const dir of watchedDirs) {
  const label = path.relative(path.dirname(workspaceDir), dir)
  watchTree(dir, label)
  console.log(`👀 watch-file-deps: watching ${label} (${watchers.size} dirs)`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (resyncTimer) clearTimeout(resyncTimer)
    await stopCommand()
    process.exit(0)
  })
}
