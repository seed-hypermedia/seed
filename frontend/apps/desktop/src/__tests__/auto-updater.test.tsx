import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {UpdateStatus} from '../types/updater-types'

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  updateHandler: undefined as undefined | ((status: UpdateStatus) => void),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {success: mocks.toastSuccess},
}))

vi.mock('@shm/ui/button', () => ({Button: () => null}))
vi.mock('@shm/ui/components/progress', () => ({Progress: () => null}))
vi.mock('@shm/ui/text', () => ({SizableText: () => null}))

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
      },
      setUpdateStatus: vi.fn(),
      downloadAndInstall: vi.fn(),
      releaseNotes: vi.fn(),
    }
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    mocks.toastSuccess.mockReset()
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
})
