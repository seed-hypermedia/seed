import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mockState = vi.hoisted(() => ({
  externalOpen: vi.fn(),
  pushNavigate: vi.fn(),
  spawnNavigate: vi.fn(),
  latestOpenUrl: null as null | ((url?: string, newWindow?: boolean) => void),
}))

vi.mock('../app-context', () => ({
  useAppContext: () => ({
    externalOpen: mockState.externalOpen,
  }),
}))

vi.mock('../utils/useNavigate', () => ({
  useNavigate: (mode?: string) => (mode === 'spawn' ? mockState.spawnNavigate : mockState.pushNavigate),
}))

import {useOpenUrl} from '../open-url'

function OpenUrlHarness() {
  mockState.latestOpenUrl = useOpenUrl()
  return null
}

function renderHarness() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<OpenUrlHarness />)
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('useOpenUrl', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.externalOpen.mockReset()
    mockState.pushNavigate.mockReset()
    mockState.spawnNavigate.mockReset()
    mockState.latestOpenUrl = null
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('routes comment URLs through in-app navigation instead of treating them as plain documents', () => {
    const {container, root} = renderHarness()

    act(() => {
      mockState.latestOpenUrl?.('hm://uid1/:comments/comment123')
    })

    expect(mockState.pushNavigate).toHaveBeenCalledWith({
      key: 'comments',
      id: unpackHmId('hm://uid1'),
      openComment: 'comment123',
      panel: null,
    })
    expect(mockState.externalOpen).not.toHaveBeenCalled()

    cleanupRendered(root, container)
  })

  it('preserves block fragments when navigating in-app URLs', () => {
    const {container, root} = renderHarness()

    act(() => {
      mockState.latestOpenUrl?.('hm://uid1/:activity/citations#blk1[5:15]')
    })

    expect(mockState.pushNavigate).toHaveBeenCalledWith({
      key: 'activity',
      id: unpackHmId('hm://uid1#blk1[5:15]'),
      filterEventType: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
      panel: null,
    })

    cleanupRendered(root, container)
  })

  it('routes inspect urls through in-app navigation', () => {
    const {container, root} = renderHarness()

    act(() => {
      mockState.latestOpenUrl?.('hm://inspect/uid1/:comments/comment123')
    })

    expect(mockState.pushNavigate).toHaveBeenCalledWith({
      key: 'inspect',
      id: unpackHmId('hm://uid1'),
      targetView: 'comments',
      targetOpenComment: 'comment123',
    })

    cleanupRendered(root, container)
  })

  it('routes inspect ipfs urls through in-app navigation', () => {
    const {container, root} = renderHarness()

    act(() => {
      mockState.latestOpenUrl?.('hm://inspect/ipfs/bafy123/path/to/node')
    })

    expect(mockState.pushNavigate).toHaveBeenCalledWith({
      key: 'inspect-ipfs',
      ipfsPath: 'bafy123/path/to/node',
    })

    cleanupRendered(root, container)
  })
})
