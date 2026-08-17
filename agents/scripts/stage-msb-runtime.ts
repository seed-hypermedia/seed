/**
 * Stages the `microsandbox` runtime into `<outdir>/node_modules` for the Docker image.
 *
 * The server bundle keeps `microsandbox` external (its napi binding, `msb` hypervisor helper,
 * and libkrunfw cannot live inside bundled JS), so the image must carry the package on disk
 * next to `main.js` — the same layout build-binary.ts ships beside the compiled desktop binary.
 * Run after `bun install` has populated agents/node_modules; the isolated linker's symlinks are
 * dereferenced into real directories so the staged tree survives a Dockerfile COPY.
 *
 * Unlike build-binary.ts there is no cross-compiling here: the install and the image share the
 * build container's platform, so the platform package is picked from the running arch.
 *
 * Usage: bun scripts/stage-msb-runtime.ts <outdir>
 */
import {cp, mkdir, rm, realpath} from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

const outdir = process.argv[2]
if (!outdir) {
  console.error('Usage: bun scripts/stage-msb-runtime.ts <outdir>')
  process.exit(1)
}

const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stagedModules = path.resolve(outdir, 'node_modules')
await rm(stagedModules, {recursive: true, force: true})
await mkdir(stagedModules, {recursive: true})

const sdkDir = await realpath(path.join(agentsDir, 'node_modules', 'microsandbox'))
await cp(sdkDir, path.join(stagedModules, 'microsandbox'), {recursive: true, dereference: true})

if (process.platform !== 'linux') {
  console.error(`This stages the linux runtime for the Docker image; refusing to run on ${process.platform}`)
  process.exit(1)
}
const platformPkg = `@superradcompany/microsandbox-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}-gnu`
const pkgDir = path.dirname(Bun.resolveSync(`${platformPkg}/package.json`, sdkDir))
await cp(pkgDir, path.join(stagedModules, platformPkg), {recursive: true, dereference: true})

console.log(`Staged microsandbox runtime (${platformPkg}) into ${stagedModules}`)
