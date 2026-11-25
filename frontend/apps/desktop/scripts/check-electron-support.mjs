import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

/**
 * The `electron` entry of the `overrides` map in pnpm-workspace.yaml. This script runs in CI
 * before `pnpm install`, so it reads the (prettier-formatted) yaml without a parser: the
 * override is a scalar on one line inside the top-level `overrides:` block.
 */
export function electronOverrideFromWorkspace(workspaceYaml) {
  const lines = workspaceYaml.split('\n')
  const start = lines.findIndex((line) => /^overrides:\s*$/.test(line))
  if (start < 0) throw new Error('pnpm-workspace.yaml has no top-level overrides block')
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break // next top-level key
    const match = line.match(/^\s+["']?electron["']?:\s*["']?([^"'\s#]+)["']?\s*$/)
    if (match) return match[1]
  }
  throw new Error('pnpm-workspace.yaml overrides have no electron entry')
}

/** Rejects prerelease pins and majors outside Electron's latest three stable release lines. */
export function checkElectronSupport(version, releases) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Electron must be pinned to an exact stable version')
  if (!Array.isArray(releases)) throw new Error('Invalid Electron release index')
  const stable = releases.filter((release) => /^\d+\.\d+\.\d+$/.test(release.version))
  if (!stable.length) throw new Error('Electron release index has no stable releases')
  const newestMajor = Math.max(...stable.map((release) => Number(release.version.split('.')[0])))
  const major = Number(version.split('.')[0])
  if (major < newestMajor - 2 || major > newestMajor || !stable.some((release) => release.version === version)) {
    throw new Error(
      `Electron ${version} is unsupported; supported majors: ${newestMajor - 2}, ${newestMajor - 1}, ${newestMajor}`,
    )
  }
  return newestMajor
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const desktop = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    // pnpm 11 keeps the workspace overrides in pnpm-workspace.yaml, not package.json#pnpm.
    const electronOverride = electronOverrideFromWorkspace(
      await readFile(new URL('../../../../pnpm-workspace.yaml', import.meta.url), 'utf8'),
    )
    const metadata = JSON.parse(await readFile(new URL('../electron-release.json', import.meta.url), 'utf8'))
    if (
      electronOverride !== desktop.devDependencies.electron ||
      metadata.version !== desktop.devDependencies.electron
    ) {
      throw new Error('Desktop Electron pin, workspace override and electron-release.json must agree')
    }
    const response = await fetch('https://releases.electronjs.org/releases.json', {signal: AbortSignal.timeout(30_000)})
    if (!response.ok) throw new Error(`Electron release index returned HTTP ${response.status}`)
    const latestMajor = checkElectronSupport(desktop.devDependencies.electron, await response.json())
    console.log(`Electron ${desktop.devDependencies.electron} is supported (latest stable major: ${latestMajor})`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
