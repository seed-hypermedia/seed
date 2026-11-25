// @vitest-environment node
import {createHash} from 'node:crypto'
import {EventEmitter} from 'node:events'
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {UpdateInfo, UpdateStatus} from '../types/updater-types'

const mocks = vi.hoisted(() => ({
  directory: '',
  send: vi.fn<(channel: string, status: UpdateStatus) => void>(),
  quit: vi.fn(),
  exit: vi.fn(),
  shutdown: vi.fn(),
  openExternal: vi.fn(),
  install: vi.fn(),
}))

vi.mock('electron', async () => {
  const {EventEmitter} = await import('node:events')
  return {
    app: Object.assign(new EventEmitter(), {
      getPath: () => mocks.directory,
      getVersion: () => '2026.1.1',
      quit: mocks.quit,
      exit: mocks.exit,
    }),
    BrowserWindow: {getFocusedWindow: () => null},
    dialog: {showMessageBoxSync: vi.fn()},
    ipcMain: new EventEmitter(),
    session: {defaultSession: Object.assign(new EventEmitter(), {downloadURL: vi.fn()})},
    shell: {openExternal: mocks.openExternal},
  }
})
vi.mock('@shm/shared/constants', () => ({AVOID_UPDATES: false, IS_PROD_DESKTOP: true, IS_PROD_DEV: false}))
vi.mock('../app-windows', () => {
  const window = {id: 1, isDestroyed: () => false, webContents: {send: mocks.send, isDestroyed: () => false}}
  return {getLastFocusedWindow: () => window, getAllWindows: () => new Map([[1, window]])}
})
vi.mock('../logger', () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}))
vi.mock('../daemon', () => ({shutdownDaemonForUpdate: mocks.shutdown}))
vi.mock('../app-http-server', () => ({stopApiServer: vi.fn()}))
vi.mock('../local-server', () => ({stopLocalServer: vi.fn()}))
vi.mock('../app-experiments', () => ({updateChromiumPolicy: vi.fn()}))
vi.mock('../auto-update-installer', () => ({installUpdate: mocks.install}))

import {ipcMain, session} from 'electron'
import {AutoUpdater} from '../auto-update'

const assetBytes = 'verified installer bytes'
const digest = createHash('sha256').update(assetBytes).digest('hex')
const updateInfo: UpdateInfo = {
  name: '2026.11.2',
  tag_name: '2026.11.2',
  release_notes: 'Update notes',
  assets: {
    macos: {
      x64: {download_url: 'https://example.com/Seed.dmg', zip_url: 'https://example.com/Seed.zip', zip_sha256: digest},
      arm64: {
        download_url: 'https://example.com/Seed.dmg',
        zip_url: 'https://example.com/Seed.zip',
        zip_sha256: digest,
      },
    },
    win32: {x64: {download_url: 'https://example.com/Seed.exe', sha256: digest}},
  },
}

describe('desktop update restart consent', () => {
  let updater: AutoUpdater

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.install.mockReset().mockResolvedValue(undefined)
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.directory = mkdtempSync(join(tmpdir(), 'seed-update-consent-'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({'content-type': 'application/json'}),
        json: async () => updateInfo,
      }),
    )
    updater = new AutoUpdater('https://example.com/latest.json')
  })

  afterEach(() => {
    updater.dispose()
    session.defaultSession.removeAllListeners('will-download')
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(mocks.directory, {recursive: true, force: true})
  })

  it.each(['darwin', 'win32'])('waits for consent after downloading on %s', async (platform) => {
    vi.stubGlobal('process', Object.create(process, {platform: {value: platform}, arch: {value: 'x64'}}))
    await updater.checkForUpdates(true)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('auto-update:status', {
        type: 'update-available',
        updateInfo,
      }),
    )

    ipcMain.emit('auto-update:download')
    const downloadUrl = platform === 'darwin' ? 'https://example.com/Seed.zip' : 'https://example.com/Seed.exe'
    const item = Object.assign(new EventEmitter(), {
      getURLChain: () => [downloadUrl],
      getFilename: () => (platform === 'darwin' ? 'Seed.zip' : 'Seed.exe'),
      setSavePath: (filePath: string) => writeFileSync(filePath, assetBytes),
      cancel: vi.fn(),
    })
    session.defaultSession.emit('will-download', {}, item)
    item.emit('done', {}, 'completed')

    await vi.waitFor(() =>
      expect(
        mocks.send.mock.calls.some(([, status]: [string, UpdateStatus]) => status.type === 'ready-to-restart'),
      ).toBe(true),
    )
    expect(mocks.send).not.toHaveBeenCalledWith('auto-update:status', {type: 'restarting'})
    expect(mocks.shutdown).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.exit).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()

    ipcMain.emit('auto-update:dismiss')
    expect(mocks.send).toHaveBeenLastCalledWith('auto-update:status', {
      type: 'ready-to-restart',
      updateInfo,
      deferred: true,
    })
    updater.checkForUpdates()
    expect(fetch).toHaveBeenCalledTimes(1)

    const send = vi.fn()
    ipcMain.emit('auto-update:get-status', {sender: {send}})
    expect(send).toHaveBeenCalledWith('auto-update:status', {
      type: 'ready-to-restart',
      updateInfo,
      deferred: true,
    })

    ipcMain.emit('auto-update:restart')
    ipcMain.emit('auto-update:restart')
    await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1))
    expect(mocks.install).toHaveBeenCalledWith(join(mocks.directory, item.getFilename()))
    expect(session.defaultSession.listenerCount('will-download')).toBe(0)
    expect(item.listenerCount('done')).toBe(0)
    expect(item.listenerCount('updated')).toBe(0)
  })

  it('does not let renderer status messages or early restart requests install an update', () => {
    ipcMain.emit('auto-update:restart')
    ipcMain.emit('auto-update:set-status', {}, {type: 'restarting'})
    expect(mocks.install).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalledWith('auto-update:status', {type: 'restarting'})
  })

  it('rejects an artifact changed while the user was waiting to restart', async () => {
    vi.stubGlobal('process', Object.create(process, {platform: {value: 'win32'}, arch: {value: 'x64'}}))
    updater.checkForUpdates(true)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('auto-update:status', {type: 'update-available', updateInfo}),
    )
    ipcMain.emit('auto-update:download')
    const filePath = join(mocks.directory, 'Seed.exe')
    const item = Object.assign(new EventEmitter(), {
      getURLChain: () => ['https://example.com/Seed.exe'],
      getFilename: () => 'Seed.exe',
      setSavePath: () => writeFileSync(filePath, assetBytes),
      cancel: vi.fn(),
    })
    session.defaultSession.emit('will-download', {}, item)
    item.emit('done', {}, 'completed')
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenLastCalledWith('auto-update:status', {
        type: 'ready-to-restart',
        updateInfo,
        deferred: false,
      }),
    )
    writeFileSync(filePath, 'corrupted installer')
    ipcMain.emit('auto-update:restart')
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenLastCalledWith('auto-update:status', {
        type: 'error',
        error: expect.stringContaining('SHA-256 mismatch'),
      }),
    )
    expect(mocks.install).not.toHaveBeenCalled()
    expect(existsSync(filePath)).toBe(false)
  })

  it('leaves Linux updates in the download website flow', async () => {
    vi.stubGlobal('process', Object.create(process, {platform: {value: 'linux'}}))
    updater.checkForUpdates(true)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('auto-update:status', {type: 'update-available', updateInfo}),
    )
    ipcMain.emit('auto-update:download')
    expect(mocks.openExternal).toHaveBeenCalledWith('https://seed.hyper.media/hm/download')
    expect(session.defaultSession.downloadURL).not.toHaveBeenCalled()
    expect(mocks.install).not.toHaveBeenCalled()
  })
})
