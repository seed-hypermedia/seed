// @vitest-environment node
import {flipFuses, FuseV1Options, FuseVersion} from '@electron/fuses'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {expect, it} from 'vitest'
import {checkElectronFuses, electronFuses} from '../../scripts/electron-fuses'

it('reads the fuse wire from disk and rejects each security fuse when it drifts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seed-fuses-'))
  const binary = join(directory, 'electron')
  try {
    // Electron's fuse wire format: sentinel, version byte, length byte, ASCII states.
    await writeFile(
      binary,
      Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 9]), Buffer.from('111111111')]),
    )
    await flipFuses(binary, electronFuses)
    await expect(checkElectronFuses(binary)).resolves.toBeUndefined()
    for (const [key, value] of Object.entries(electronFuses)) {
      if (key === 'version') continue
      const fuse = Number(key) as FuseV1Options
      await flipFuses(binary, {version: FuseVersion.V1, [fuse]: !value})
      await expect(checkElectronFuses(binary)).rejects.toThrow(FuseV1Options[fuse])
      await flipFuses(binary, electronFuses)
    }
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})
