/**
 * Stages the packages the server bundle keeps external into `<outdir>/node_modules` for the
 * Docker image.
 *
 * Two runtimes cannot live inside bundled JS and must be on disk next to `main.js`:
 *
 *  - `microsandbox` (its napi binding, `msb` hypervisor helper, and libkrunfw) — the same layout
 *    build-binary.ts ships beside the compiled desktop binary. Staged as before: the package and
 *    its linux platform package, dereferenced into real directories.
 *  - the LiveKit voice worker's framework (`@livekit/agents` + the deepgram/cartesia/silero/livekit
 *    plugins, see build.ts) — native ffi bindings (`@livekit/rtc-ffi-bindings-linux-*`), ONNX
 *    runtime (`onnxruntime-node`), `@livekit/local-inference-linux-*`, `@livekit/av-linux-*`, and
 *    child processes forked from files inside the package. These have a deep dependency tree with
 *    duplicate versions, so instead of flattening they are staged as bun's isolated-linker store:
 *    every `node_modules/.bun/<name>@<version>/` entry in the dependency closure is copied with
 *    its relative symlinks intact (they only point inside `.bun/`, so the tree stays valid after a
 *    Dockerfile COPY), plus a top-level `node_modules/<name>` link for each root package.
 *
 * Run after `bun install` has populated agents/node_modules. Platform packages are whatever the
 * install put on disk: the install and the image share the build container's platform, so
 * optional dependencies for other platforms are simply absent and skipped.
 *
 * Usage: bun scripts/stage-msb-runtime.ts <outdir>
 */
import {cp, lstat, mkdir, readdir, readFile, readlink, realpath, rm, symlink} from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

/** Top-level packages the bundle imports by name (build.ts `external`) that live in node_modules. */
const LIVEKIT_ROOTS = [
  '@livekit/agents',
  '@livekit/agents-plugin-deepgram',
  '@livekit/agents-plugin-cartesia',
  '@livekit/agents-plugin-silero',
  '@livekit/agents-plugin-livekit',
]

const outdir = process.argv[2]
if (!outdir) {
  console.error('Usage: bun scripts/stage-msb-runtime.ts <outdir>')
  process.exit(1)
}

const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeModules = path.join(agentsDir, 'node_modules')
const storeDir = path.join(nodeModules, '.bun')
const stagedModules = path.resolve(outdir, 'node_modules')
await rm(stagedModules, {recursive: true, force: true})
await mkdir(stagedModules, {recursive: true})

const sdkDir = await realpath(path.join(nodeModules, 'microsandbox'))
await cp(sdkDir, path.join(stagedModules, 'microsandbox'), {recursive: true, dereference: true})

if (process.platform !== 'linux') {
  console.error(`This stages the linux runtime for the Docker image; refusing to run on ${process.platform}`)
  process.exit(1)
}
const platformPkg = `@superradcompany/microsandbox-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}-gnu`
const pkgDir = path.dirname(Bun.resolveSync(`${platformPkg}/package.json`, sdkDir))
await cp(pkgDir, path.join(stagedModules, platformPkg), {recursive: true, dereference: true})

console.log(`Staged microsandbox runtime (${platformPkg}) into ${stagedModules}`)

const entries = await stageStoreClosure(LIVEKIT_ROOTS)
console.log(`Staged LiveKit voice runtime (${entries} store entries) into ${stagedModules}`)

/**
 * Copies the isolated-linker store entries reachable from `roots` and links the roots at the top
 * level. Returns the number of store entries staged.
 */
async function stageStoreClosure(roots: string[]): Promise<number> {
  /** store entry → real directory of the package it holds */
  const seen = new Map<string, string>()
  /** hoisted `.bun/node_modules/<name>` links to recreate (name → link target, verbatim) */
  const hoisted = new Map<string, string>()
  const queue: string[] = []
  for (const root of roots) {
    const real = await realpath(path.join(nodeModules, root))
    queue.push(real)
    const link = path.join(stagedModules, root)
    await mkdir(path.dirname(link), {recursive: true})
    await symlink(path.relative(path.dirname(link), path.join(stagedModules, path.relative(nodeModules, real))), link)
  }
  while (queue.length > 0) {
    const pkgRealDir = queue.shift()!
    const entry = storeEntryOf(pkgRealDir)
    if (!entry || seen.has(entry)) continue
    seen.set(entry, pkgRealDir)
    for (const dep of await dependencyNames(pkgRealDir)) {
      const depDir = await resolveDependency(pkgRealDir, dep)
      if (depDir) queue.push(depDir)
    }
    // The store also hoists one version of every package into `.bun/node_modules/<name>`, which
    // is how an undeclared ("phantom") dependency resolves at runtime — e.g. @huggingface/transformers
    // importing onnxruntime-common. Keep that link, and whatever version it points at, for every
    // staged package so the image resolves exactly what the build container did.
    const name = await packageName(pkgRealDir)
    if (name && !hoisted.has(name)) {
      const link = path.join(storeDir, 'node_modules', name)
      try {
        if ((await lstat(link)).isSymbolicLink()) {
          hoisted.set(name, await readlink(link))
          queue.push(await realpath(link))
        }
      } catch {
        /* no hoisted link for this package */
      }
    }
  }
  for (const entry of seen.keys()) {
    await copyTreeKeepingLinks(path.join(storeDir, entry), path.join(stagedModules, '.bun', entry))
  }
  for (const [name, target] of hoisted) {
    const link = path.join(stagedModules, '.bun', 'node_modules', name)
    await mkdir(path.dirname(link), {recursive: true})
    await symlink(target, link)
  }
  return seen.size
}

async function packageName(pkgDir: string): Promise<string | null> {
  const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')) as {name?: string}
  return typeof pkg.name === 'string' ? pkg.name : null
}

/** `<name>@<version>` store entry a real package path belongs to, or null when not in the store. */
function storeEntryOf(pkgRealDir: string): string | null {
  const rel = path.relative(storeDir, pkgRealDir)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep)[0] ?? null
}

async function dependencyNames(pkgDir: string): Promise<string[]> {
  const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  return Object.keys({...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies})
}

/**
 * Where `dep` resolves for the package at `pkgRealDir`: the isolated linker links a package's
 * dependencies beside it in its store entry's node_modules, with the top level as fallback.
 * Returns null when the dependency is not installed (an optional dependency for another platform).
 */
async function resolveDependency(pkgRealDir: string, dep: string): Promise<string | null> {
  const entry = storeEntryOf(pkgRealDir)
  const candidates = [...(entry ? [path.join(storeDir, entry, 'node_modules', dep)] : []), path.join(nodeModules, dep)]
  for (const candidate of candidates) {
    try {
      return await realpath(candidate)
    } catch {
      /* not here */
    }
  }
  return null
}

/** Recursive copy that recreates symlinks verbatim (relative targets included) instead of following them. */
async function copyTreeKeepingLinks(src: string, dst: string): Promise<void> {
  const stat = await lstat(src)
  if (stat.isSymbolicLink()) {
    await mkdir(path.dirname(dst), {recursive: true})
    await symlink(await readlink(src), dst)
    return
  }
  if (stat.isDirectory()) {
    await mkdir(dst, {recursive: true})
    for (const name of await readdir(src)) await copyTreeKeepingLinks(path.join(src, name), path.join(dst, name))
    return
  }
  await mkdir(path.dirname(dst), {recursive: true})
  await cp(src, dst, {dereference: false})
}
