import {_electron as electron} from '@playwright/test'
import {flipFuses, FuseV1Options, FuseVersion} from '@electron/fuses'
import {execFileSync} from 'node:child_process'
import {cp, mkdtemp, rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {checkElectronFuses} from '../scripts/electron-fuses'

/** Gives Playwright inspector access only in a disposable copy of a verified hardened build. */
export async function launchPackagedApp(options: Parameters<typeof electron.launch>[0] & {executablePath: string}) {
  const sourceExecutable = options.executablePath
  const source =
    process.platform === 'darwin' ? path.resolve(sourceExecutable, '../../..') : path.dirname(sourceExecutable)
  await checkElectronFuses(process.platform === 'darwin' ? source : sourceExecutable)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'seed-playwright-'))
  const copy = path.join(temporary, path.basename(source))
  try {
    await cp(source, copy, {recursive: true})
    const executablePath = path.join(copy, path.relative(source, sourceExecutable))
    await flipFuses(process.platform === 'darwin' ? copy : executablePath, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableNodeCliInspectArguments]: true,
    })
    if (process.platform === 'darwin') execFileSync('codesign', ['--force', '--deep', '--sign', '-', copy])
    const app = await electron.launch({...options, executablePath, args: []})
    app.once('close', () => void rm(temporary, {recursive: true, force: true}))
    return app
  } catch (error) {
    await rm(temporary, {recursive: true, force: true})
    throw error
  }
}
