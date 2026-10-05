import {readFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'

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
    const root = JSON.parse(await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'))
    const metadata = JSON.parse(await readFile(new URL('../electron-release.json', import.meta.url), 'utf8'))
    if (
      root.pnpm.overrides.electron !== desktop.devDependencies.electron ||
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
