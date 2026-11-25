import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createActor, waitFor} from 'xstate'
import {
  createAutoUpdateMachine,
  getAutoUpdateStatus,
  type AutoUpdateActor,
  type AutoUpdateDependencies,
  type UpdateDownloadCallbacks,
} from '../auto-update-machine'
import type {UpdateInfo} from '../types/updater-types'

const updateInfo: UpdateInfo = {name: '2026.11.2', tag_name: '2026.11.2', release_notes: '', assets: {}}
const downloaded = {filePath: '/tmp/Seed.zip', expectedSha256: 'verified-digest'}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return {promise, resolve, reject}
}

describe('auto-update machine', () => {
  let actor: AutoUpdateActor
  let callbacks: UpdateDownloadCallbacks
  let dependencies: AutoUpdateDependencies
  const unsubscribe = vi.fn()

  beforeEach(() => {
    unsubscribe.mockReset()
    dependencies = {
      checkForUpdates: vi.fn().mockResolvedValue(updateInfo),
      downloadUpdate: vi.fn((_, handlers) => {
        callbacks = handlers
        return unsubscribe
      }),
      verifyUpdate: vi.fn().mockResolvedValue(undefined),
      installUpdate: vi.fn().mockResolvedValue(undefined),
      usesExternalDownload: () => false,
      openDownloadPage: vi.fn(),
    }
    actor = createActor(createAutoUpdateMachine(dependencies)).start()
  })

  afterEach(() => actor.stop())

  async function startDownload() {
    actor.send({type: 'check.requested', manual: true})
    await waitFor(actor, (snapshot) => snapshot.matches('available'))
    actor.send({type: 'download.requested'})
  }

  async function finishDownload() {
    await startDownload()
    callbacks.onComplete(downloaded)
    await waitFor(actor, (snapshot) => snapshot.matches('ready'))
  }

  it('requires fresh restart consent after verification and installs only once', async () => {
    const verification = deferred<void>()
    vi.mocked(dependencies.verifyUpdate).mockReturnValueOnce(verification.promise)
    actor.send({type: 'restart.requested'})
    actor.send({type: 'download.requested'})
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
    expect(dependencies.downloadUpdate).not.toHaveBeenCalled()
    await startDownload()
    actor.send({type: 'restart.requested'})
    actor.send({type: 'download.requested'})
    actor.send({type: 'check.requested', manual: false})
    callbacks.onProgress(75)
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'downloading', progress: 75})
    callbacks.onComplete(downloaded)
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'verifying'})
    expect(unsubscribe).toHaveBeenCalledOnce()
    actor.send({type: 'restart.requested'})
    actor.send({type: 'dismiss'})
    actor.send({type: 'check.requested', manual: true})
    verification.resolve()
    await waitFor(actor, (snapshot) => snapshot.matches('ready'))
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
    expect(dependencies.checkForUpdates).toHaveBeenCalledOnce()
    expect(dependencies.downloadUpdate).toHaveBeenCalledOnce()

    const installation = deferred<void>()
    vi.mocked(dependencies.installUpdate).mockReturnValueOnce(installation.promise)
    actor.send({type: 'restart.requested'})
    actor.send({type: 'restart.requested'})
    actor.send({type: 'download.requested'})
    actor.send({type: 'check.requested', manual: false})
    await vi.waitFor(() => expect(dependencies.installUpdate).toHaveBeenCalledExactlyOnceWith(downloaded.filePath))
    expect(dependencies.verifyUpdate).toHaveBeenCalledTimes(2)
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'restarting'})
    installation.resolve()
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
  })

  it('retains a deferred update across checks and can reopen the restart prompt', async () => {
    await finishDownload()
    actor.send({type: 'dismiss'})
    actor.send({type: 'check.requested', manual: false})
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'ready-to-restart', updateInfo, deferred: true})
    actor.send({type: 'check.requested', manual: true})
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'ready-to-restart', updateInfo, deferred: false})
    expect(dependencies.checkForUpdates).toHaveBeenCalledOnce()
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
    actor.send({type: 'dismiss'})
    actor.send({type: 'restart.requested'})
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    expect(dependencies.installUpdate).toHaveBeenCalledExactlyOnceWith(downloaded.filePath)
  })

  it('does not let late download events overwrite a verified update', async () => {
    await finishDownload()
    callbacks.onProgress(5)
    callbacks.onError(new Error('late download error'))
    callbacks.onComplete({filePath: '/tmp/different.zip'})
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'ready-to-restart', updateInfo, deferred: false})
    actor.send({type: 'restart.requested'})
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))
    expect(dependencies.installUpdate).toHaveBeenCalledExactlyOnceWith(downloaded.filePath)
  })

  it('never offers restart when verification fails and allows a fresh retry', async () => {
    vi.mocked(dependencies.verifyUpdate).mockRejectedValueOnce(new Error('SHA-256 mismatch'))
    await startDownload()
    callbacks.onComplete(downloaded)
    await waitFor(actor, (snapshot) => snapshot.matches('error'))
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'error', error: 'SHA-256 mismatch'})
    actor.send({type: 'restart.requested'})
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
    await finishDownload()
    expect(dependencies.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
  })

  it('reports a download failure without starting verification', async () => {
    await startDownload()
    callbacks.onError(new Error('Download cancelled'))
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'error', error: 'Download cancelled'})
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(dependencies.verifyUpdate).not.toHaveBeenCalled()
    actor.send({type: 'restart.requested'})
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
  })

  it('reports download setup exceptions without stopping the coordinator', async () => {
    vi.mocked(dependencies.downloadUpdate).mockImplementationOnce(() => {
      throw new Error('Download unavailable')
    })
    await startDownload()
    await waitFor(actor, (snapshot) => snapshot.matches('error'))
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'error', error: 'Download unavailable'})
    await finishDownload()
    expect(dependencies.installUpdate).not.toHaveBeenCalled()
  })

  it('requires a new download and consent after an installation failure', async () => {
    vi.mocked(dependencies.installUpdate).mockRejectedValueOnce(new Error('Installation failed'))
    await finishDownload()
    actor.send({type: 'restart.requested'})
    await waitFor(actor, (snapshot) => snapshot.matches('error'))
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'error', error: 'Installation failed'})
    actor.send({type: 'restart.requested'})
    expect(dependencies.installUpdate).toHaveBeenCalledOnce()
    await finishDownload()
    expect(dependencies.installUpdate).toHaveBeenCalledOnce()
  })

  it('reports check failures and serializes repeated check requests', async () => {
    const check = deferred<UpdateInfo | null>()
    vi.mocked(dependencies.checkForUpdates).mockReturnValueOnce(check.promise)
    actor.send({type: 'check.requested', manual: true})
    actor.send({type: 'check.requested', manual: true})
    actor.send({type: 'restart.requested'})
    expect(dependencies.checkForUpdates).toHaveBeenCalledOnce()
    check.reject(new Error('Offline'))
    await waitFor(actor, (snapshot) => snapshot.matches('error'))
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'error', error: 'Offline'})
    actor.send({type: 'dismiss'})
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: 'idle'})
    await finishDownload()
  })

  it.each([true, false])('reports no update appropriately for manual=%s', async (manual) => {
    vi.mocked(dependencies.checkForUpdates).mockResolvedValueOnce(null)
    actor.send({type: 'check.requested', manual})
    await waitFor(actor, (snapshot) => !snapshot.matches('checking'))
    expect(getAutoUpdateStatus(actor.getSnapshot())).toEqual({type: manual ? 'up-to-date' : 'idle'})
  })

  it('unsubscribes an active download when the actor stops', async () => {
    await startDownload()
    actor.stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
