/**
 * Compiles the agents server into a standalone binary for the desktop app.
 *
 * The desktop spawns this artifact from its resources directory (see
 * `frontend/apps/desktop/src/agents-server-path.ts`), so the output layout is a contract:
 *
 *   <outdir>/seed-agents-<llvm-triple>[.exe]   the compiled server
 *   <outdir>/package.json                      required next to the binary — pi-coding-agent
 *                                              reads its package.json relative to cwd at import
 *
 * Binaries are named by LLVM triple to match the Go daemon (`seed-daemon-<triple>`), so the
 * release pipeline and forge config treat both the same way.
 *
 * Usage: bun scripts/build-binary.ts [--target=<llvm-triple>] [--outdir=<dir>] [--smoke]
 * Defaults: host target, `<repo>/plz-out/bin/agents`. `--smoke` boots the built binary and
 * checks `/agents/api/health` (host-target builds only).
 */
import tailwind from 'bun-plugin-tailwind'
import {mkdir, rm, cp, mkdtemp, readdir, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(agentsDir)

/** LLVM triple (the artifact naming scheme) → bun compile target. */
const BUN_TARGETS: Record<string, string> = {
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'x86_64-pc-windows-gnu': 'bun-windows-x64',
}

/** LLVM triple → napi platform package carrying the `msb` helper, libkrunfw, and `.node` binding. */
const MICROSANDBOX_PLATFORM_PKGS: Record<string, string | null> = {
  // microsandbox publishes no darwin-x64 build, so Intel Mac apps ship without execute_code.
  'x86_64-apple-darwin': null,
  'aarch64-apple-darwin': '@superradcompany/microsandbox-darwin-arm64',
  'x86_64-unknown-linux-gnu': '@superradcompany/microsandbox-linux-x64-gnu',
  'aarch64-unknown-linux-gnu': '@superradcompany/microsandbox-linux-arm64-gnu',
  'x86_64-pc-windows-gnu': '@superradcompany/microsandbox-win32-x64-msvc',
}

function hostTriple(): string {
  const key = `${process.platform}/${process.arch}`
  const triple = {
    'darwin/x64': 'x86_64-apple-darwin',
    'darwin/arm64': 'aarch64-apple-darwin',
    'linux/x64': 'x86_64-unknown-linux-gnu',
    'linux/arm64': 'aarch64-unknown-linux-gnu',
    'win32/x64': 'x86_64-pc-windows-gnu',
  }[key]
  if (!triple) throw new Error(`No agents-server target for host platform ${key}`)
  return triple
}

function argValue(name: string): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`))
  return arg?.slice(name.length + 3)
}

const triple = argValue('target') || hostTriple()
const bunTarget = BUN_TARGETS[triple]
if (!bunTarget) {
  throw new Error(`Unknown target triple ${triple}. Known: ${Object.keys(BUN_TARGETS).join(', ')}`)
}
const outdir = path.resolve(argValue('outdir') || path.join(agentsDir, '..', 'plz-out', 'bin', 'agents'))
const fileName = `seed-agents-${triple}${triple.includes('windows') ? '.exe' : ''}`
const outfile = path.join(outdir, fileName)

await mkdir(outdir, {recursive: true})
// Remove stale binaries for other triples so the directory can be shipped wholesale as an
// Electron extraResource without dragging an old 80 MB artifact along.
for (const existing of await readdir(outdir)) {
  if (existing.startsWith('seed-agents-') && existing !== fileName) {
    await rm(path.join(outdir, existing), {force: true})
  }
}

console.log(`Compiling ${fileName} (${bunTarget})…`)
const result = await Bun.build({
  entrypoints: ['./src/main.ts'],
  target: 'bun',
  minify: true,
  define: {'process.env.NODE_ENV': JSON.stringify('production')},
  publicPath: '/agents/',
  root: './src',
  plugins: [tailwind],
  // Bundling `microsandbox` breaks it: its napi binding, `msb` hypervisor helper, and libkrunfw
  // cannot live in the binary's virtual filesystem, so the bundled JS dies at execute_code time
  // with "Cannot find module '../../native/index.cjs'". Kept external and staged on disk below.
  // `canvas` is an optional native dep reached only through linkedom's guarded require — its
  // fallback shim covers us — and bundling it fails on machines where the binding never compiled.
  external: ['microsandbox', 'canvas'],
  compile: {target: bunTarget as any, outfile},
})
if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// pi-coding-agent resolves its own package.json against cwd at import time, so the compiled
// binary only starts with this file alongside — the same layout agents/Dockerfile ships.
await cp(path.join(agentsDir, 'package.json'), path.join(outdir, 'package.json'))

// Stage the external `microsandbox` package — and the platform package with the native pieces —
// into node_modules/ next to the binary, where the runtime loader resolves it from.
const stagedModules = path.join(outdir, 'node_modules')
await rm(stagedModules, {recursive: true, force: true})
const sdkDir = await realpath(path.join(agentsDir, 'node_modules', 'microsandbox'))
await cp(sdkDir, path.join(stagedModules, 'microsandbox'), {recursive: true, dereference: true})
const platformPkg = MICROSANDBOX_PLATFORM_PKGS[triple]
if (platformPkg) {
  const pkgDir = path.dirname(Bun.resolveSync(`${platformPkg}/package.json`, sdkDir))
  await cp(pkgDir, path.join(stagedModules, platformPkg), {recursive: true, dereference: true})
  // The compiled binary cannot resolve bare specifiers from disk modules, so the napi loader's
  // `require('@superradcompany/...')` fallback never works there. Its first attempt is a relative
  // `require('./microsandbox.<platform>.node')` — satisfy that by copying the binding next to
  // native/index.cjs. (`msb` and libkrunfw stay in the platform package; the runtime loader
  // points MSB_PATH/MSB_LIBKRUNFW_PATH at them.)
  const nodeBinding = (await readdir(path.join(stagedModules, platformPkg))).find((f) => f.endsWith('.node'))
  if (!nodeBinding) throw new Error(`No .node binding found in ${platformPkg}`)
  await cp(
    path.join(stagedModules, platformPkg, nodeBinding),
    path.join(stagedModules, 'microsandbox', 'native', nodeBinding),
  )
  console.log(`Staged microsandbox runtime (${platformPkg})`)
} else {
  console.warn(`⚠️ microsandbox has no native build for ${triple} — packaging without execute_code support.`)
}

console.log(`Built ${outfile}`)

if (process.argv.includes('--smoke')) {
  if (triple !== hostTriple()) {
    console.log('Skipping smoke test: target does not match host')
    process.exit(0)
  }
  await smokeTest(outfile)
  if (platformPkg) await execSelfcheck(outfile)
}

/** Runs the compiled binary's `--exec-selfcheck`, which loads the staged microsandbox SDK. */
async function execSelfcheck(binary: string): Promise<void> {
  const proc = Bun.spawn([binary, '--exec-selfcheck'], {cwd: outdir, stdout: 'pipe', stderr: 'pipe'})
  const code = await proc.exited
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (code !== 0) {
    throw new Error(`exec-selfcheck failed (exit ${code}): ${(stderr || stdout).trim()}`)
  }
  console.log(stdout.trim() || 'exec-selfcheck passed')
}

/** Boots the compiled binary against temp dirs and waits for a healthy `/agents/api/health`. */
async function smokeTest(binary: string): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'seed-agents-smoke-'))
  const port = 41_000 + Math.floor(Math.random() * 1_000)
  const server = Bun.spawn(
    [
      binary,
      '--server-hostname=127.0.0.1',
      `--server-port=${port}`,
      `--db-path=${path.join(dataDir, 'agents.sqlite')}`,
      `--data-dir=${dataDir}`,
    ],
    {cwd: outdir, stdout: 'pipe', stderr: 'pipe'},
  )
  let exitCode: number | null = null
  server.exited.then((code) => {
    exitCode = code
  })
  try {
    let lastError: unknown
    // Windows CI can hold a fresh unsigned exe behind a Defender scan on first launch,
    // so the window is generous.
    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      if (exitCode !== null) {
        throw new Error(`Compiled binary exited with code ${exitCode} before becoming healthy`)
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/agents/api/health`)
        const body: any = response.ok ? await response.json() : null
        if (body?.status === 'ok') {
          console.log(`Smoke test passed: compiled binary healthy on port ${port}`)
          return
        }
        lastError = new Error(`Unexpected health response ${response.status}: ${JSON.stringify(body)}`)
      } catch (error) {
        lastError = error
      }
      await Bun.sleep(250)
    }
    throw new Error(`Compiled binary never became healthy: ${lastError}`)
  } finally {
    server.kill('SIGTERM')
    await Promise.race([server.exited, Bun.sleep(2_000).then(() => server.kill('SIGKILL'))])
    const [stdout, stderr] = await Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()])
    if (stdout.trim()) console.log(stdout.trim())
    if (stderr.trim()) console.error(stderr.trim())
    if (!stdout.trim() && !stderr.trim()) console.error('(server produced no output)')
    await rm(dataDir, {recursive: true, force: true})
  }
}
