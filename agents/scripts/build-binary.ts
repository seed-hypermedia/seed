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
import {mkdir, rm, cp, mkdtemp, readdir} from 'node:fs/promises'
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

console.log(`Built ${outfile}`)

if (process.argv.includes('--smoke')) {
  if (triple !== hostTriple()) {
    console.log('Skipping smoke test: target does not match host')
    process.exit(0)
  }
  await smokeTest(outfile)
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
  try {
    let lastError: unknown
    for (let attempt = 0; attempt < 40; attempt += 1) {
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
    await rm(dataDir, {recursive: true, force: true})
  }
}
