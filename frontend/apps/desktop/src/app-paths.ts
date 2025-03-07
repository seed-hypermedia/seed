import {DESKTOP_APPDATA, IS_TEST} from '@shm/shared/constants'
import {app} from 'electron'
import {mkdtempSync} from 'fs'
import os from 'os'
import path from 'path'

export const userDataPath = IS_TEST
  ? mkdtempSync(path.join(os.tmpdir(), 'hm-'))
  : path.join(app.getPath('appData'), DESKTOP_APPDATA!)

export function initPaths() {
  app.setPath('userData', userDataPath)
}
