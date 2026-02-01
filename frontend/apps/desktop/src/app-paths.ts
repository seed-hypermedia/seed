import {DESKTOP_APPDATA, IS_TEST} from '@shm/shared/constants'
import {app} from 'electron'
import {mkdtempSync} from 'fs'
import os from 'os'
import path from 'path'

function getUserDataPath(): string {
  // Fixture mode: use explicit path from env var
  if (process.env.SEED_FIXTURE_DATA_DIR) {
    return process.env.SEED_FIXTURE_DATA_DIR
  }
  // Test mode: use temp directory
  if (IS_TEST) {
    return mkdtempSync(path.join(os.tmpdir(), 'hm-'))
  }
  // Normal mode: use system app data
  return path.join(app.getPath('appData'), DESKTOP_APPDATA!)
}

export const userDataPath = getUserDataPath()

export function initPaths() {
  app.setPath('userData', userDataPath)
}
