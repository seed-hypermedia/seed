import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {UpdateInfo, UpdateStatus} from '../types/updater-types'

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  updateHandler: undefined as undefined | ((status: UpdateStatus) => void),
  unsubscribe: vi.fn(),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {success: mocks.toastSuccess},
}))

const updateInfo: UpdateInfo = {name: '2026.11.2', tag_name: '2026.11.2', release_notes: 'New release', assets: {}}

describe('AutoUpdater', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('React', React)
    container = document.createElement('div')
    document.body.appendChild(container)
    window.autoUpdate = {
      checkForUpdates: vi.fn(),
      onUpdateStatus: (handler) => {
        mocks.updateHandler = handler
        return mocks.unsubscribe
      },
      dismiss: vi.fn(),
      download: vi.fn(),
      restart: vi.fn(),
      releaseNotes: vi.fn(),
    }
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.toastSuccess.mockReset()
    mocks.unsubscribe.mockReset()
    mocks.updateHandler = undefined
    delete window.autoUpdate
    vi.unstubAllGlobals()
  })

  it('shows a toast when a manual update check finds no update', async () => {
    const {AutoUpdater} = await import('../components/auto-updater')

    act(() => root.render(<AutoUpdater />))
    act(() => mocks.updateHandler?.({type: 'up-to-date'}))

    expect(mocks.toastSuccess).toHaveBeenCalledWith("You're up to date")
  })

  it('does not show the up-to-date toast while downloading an update', async () => {
    const {AutoUpdater} = await import('../components/auto-updater')

    act(() => root.render(<AutoUpdater />))
    mocks.toastSuccess.mockClear()

    act(() => mocks.updateHandler?.({type: 'downloading', progress: 10}))
    act(() => mocks.updateHandler?.({type: 'downloading', progress: 50}))

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('downloads without requesting a restart and waits for the Restart click', async () => {
    const {AutoUpdater} = await import('../components/auto-updater')
    act(() => root.render(<AutoUpdater />))
    act(() => mocks.updateHandler?.({type: 'update-available', updateInfo}))
    const download = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Download Update',
    )!
    act(() => download.click())
    expect(window.autoUpdate?.download).toHaveBeenCalledOnce()
    expect(window.autoUpdate?.restart).not.toHaveBeenCalled()

    act(() => mocks.updateHandler?.({type: 'ready-to-restart', updateInfo, deferred: false}))
    expect(container.textContent).toContain('Keep working and restart when you’re ready.')
    expect(window.autoUpdate?.restart).not.toHaveBeenCalled()
    const restart = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Restart')!
    act(() => restart.click())
    expect(window.autoUpdate?.restart).toHaveBeenCalledOnce()
  })

  it('defers the ready update without requesting a restart', async () => {
    const {AutoUpdater} = await import('../components/auto-updater')
    act(() => root.render(<AutoUpdater />))
    act(() => mocks.updateHandler?.({type: 'ready-to-restart', updateInfo, deferred: false}))
    const later = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Later')!
    act(() => later.click())
    expect(window.autoUpdate?.dismiss).toHaveBeenCalledOnce()
    expect(window.autoUpdate?.restart).not.toHaveBeenCalled()
    act(() => mocks.updateHandler?.({type: 'ready-to-restart', updateInfo, deferred: true}))
    expect(container.querySelector('button')).toBeNull()
  })

  it.each<UpdateStatus>([{type: 'downloading', progress: 100}, {type: 'verifying'}, {type: 'restarting'}])(
    'does not offer restart during $type',
    async (status) => {
      const {AutoUpdater} = await import('../components/auto-updater')
      act(() => root.render(<AutoUpdater />))
      act(() => mocks.updateHandler?.(status))
      expect(container.querySelector('button')).toBeNull()
      expect(window.autoUpdate?.restart).not.toHaveBeenCalled()
    },
  )

  it('shows errors with a way to check again', async () => {
    const {AutoUpdater} = await import('../components/auto-updater')
    act(() => root.render(<AutoUpdater />))
    act(() => mocks.updateHandler?.({type: 'error', error: 'Download verification failed'}))
    expect(container.textContent).toContain('Download verification failed')
    act(() => container.querySelector('button')!.click())
    expect(window.autoUpdate?.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('unsubscribes when the updater is unmounted', async () => {
    const {AutoUpdater} = await import('../components/auto-updater')
    act(() => root.render(<AutoUpdater />))
    act(() => root.render(null))
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })
})
