#!/usr/bin/env bun
/**
 * Protocol surface snapshot and compatibility gate.
 *
 *   bun scripts/protocol-surface.ts write   # regenerate agents/protocol/surface.json from the types
 *   bun scripts/protocol-surface.ts check   # CI: snapshot is current, and no unversioned breaking change
 *   bun scripts/protocol-surface.ts diff    # print the classified changes against the base, exit 0
 *
 * `check` compares the working tree against the snapshot committed on the base branch:
 * `$PROTOCOL_BASE_REF` when set, else the merge-base with `origin/main` (falling back to `main`).
 * On a fresh clone in CI fetch the base first (`git fetch origin main`). See
 * `agents/protocol/PROTOCOL.md` for what counts as breaking and what to do about it.
 */
import {spawnSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {extractSurface, judgeSurfaceChange, type ProtocolSurface} from '../src/protocol-surface'

const agentsDir = path.resolve(import.meta.dir, '..')
const surfacePath = path.join(agentsDir, 'protocol', 'surface.json')
const changelogPath = path.join(agentsDir, 'protocol', 'PROTOCOL.md')
const surfaceRepoPath = 'agents/protocol/surface.json'

function git(args: string[]): string | null {
  const result = spawnSync('git', args, {cwd: agentsDir, encoding: 'utf8'})
  return result.status === 0 ? result.stdout : null
}

function baseRef(): string {
  const configured = process.env.PROTOCOL_BASE_REF
  if (configured) return configured
  for (const candidate of ['origin/main', 'main']) {
    const merged = git(['merge-base', 'HEAD', candidate])
    if (merged) return merged.trim()
  }
  throw new Error('cannot find a base to compare with: set PROTOCOL_BASE_REF or fetch origin/main')
}

function baseSurface(ref: string): ProtocolSurface | null {
  const text = git(['show', `${ref}:${surfaceRepoPath}`])
  return text ? (JSON.parse(text) as ProtocolSurface) : null
}

function serialize(surface: ProtocolSurface): string {
  return `${JSON.stringify(surface, null, 2)}\n`
}

const mode = process.argv[2] ?? 'check'
if (mode !== 'write' && mode !== 'check' && mode !== 'diff') {
  console.error(`unknown mode ${mode}; use write, check, or diff`)
  process.exit(2)
}
const current = extractSurface()

if (mode === 'write') {
  writeFileSync(surfacePath, serialize(current))
  console.log(`wrote ${path.relative(process.cwd(), surfacePath)} (protocol ${current.protocol})`)
  process.exit(0)
}

const ref = baseRef()
const base = baseSurface(ref)
const changelog = readFileSync(changelogPath, 'utf8')

const baseComparable = base !== null && base.format === current.format
if (base && !baseComparable) {
  console.log(`${surfaceRepoPath} at ${ref} was written in snapshot format ${base.format} (now ${current.format})`)
}

if (mode === 'diff') {
  if (!baseComparable) {
    console.log(`nothing to compare against ${ref}`)
    process.exit(0)
  }
  const verdict = judgeSurfaceChange(base, current, changelog)
  for (const change of verdict.changes) {
    const tag = change.severity === 'breaking' ? 'BREAKING' : 'ok      '
    console.log(`${tag} ${change.path}: ${change.detail} [${change.direction}]`)
  }
  if (verdict.changes.length === 0) console.log('no protocol changes')
  process.exit(0)
}

const problems: string[] = []
let committed: string | null = null
try {
  committed = readFileSync(surfacePath, 'utf8')
} catch {
  problems.push(`${surfaceRepoPath} is missing`)
}
if (committed !== null && committed !== serialize(current)) {
  problems.push(
    `${surfaceRepoPath} is out of date with the protocol types: run \`bun run protocol:snapshot\` and commit it`,
  )
}

if (baseComparable) {
  const verdict = judgeSurfaceChange(base, current, changelog)
  problems.push(...verdict.problems)
  const compatible = verdict.changes.filter((change) => change.severity === 'compatible')
  if (compatible.length > 0) {
    console.log(`${compatible.length} compatible protocol change${compatible.length === 1 ? '' : 's'} against ${ref}`)
  }
} else {
  console.log(`skipping the compatibility diff against ${ref}`)
}

if (problems.length > 0) {
  console.error('\nProtocol check failed:\n')
  for (const problem of problems) console.error(`* ${problem}\n`)
  console.error('See agents/protocol/PROTOCOL.md for the rules.')
  process.exit(1)
}
console.log(`protocol ${current.protocol} surface is current and compatible`)
