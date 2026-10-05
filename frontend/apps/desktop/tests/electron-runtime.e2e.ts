import {expect, test} from '@playwright/test'
import release from '../electron-release.json'
import {startApp} from '../test/utils'

test('packaged app runs the pinned Electron, Chromium and Node releases', async () => {
  const {app} = await startApp()
  try {
    const versions = await app.evaluate(() => ({
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    }))
    console.info('Packaged Electron runtime:', versions)
    expect(versions).toEqual({electron: release.version, chromium: release.chromium, node: release.node})
  } finally {
    await app.close()
  }
})
