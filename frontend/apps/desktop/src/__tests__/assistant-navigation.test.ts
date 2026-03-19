import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'

vi.mock('../app-windows', () => ({
  createAppWindow: vi.fn(),
  getFocusedWindow: vi.fn(),
}))

import {navigateDesktopUrl} from '../assistant-navigation'

describe('navigateDesktopUrl', () => {
  it('pushes a parseable route into the focused window by default', () => {
    const send = vi.fn()
    const createAppWindow = vi.fn()

    const result = navigateDesktopUrl(
      'hm://uid1/:comments/comment123',
      {},
      {
        createAppWindow,
        getFocusedWindow: () =>
          ({
            webContents: {send},
          }) as any,
      },
    )

    expect(result).toBe('Opened comment thread in the current window.')
    expect(send).toHaveBeenCalledWith('open_route', {
      key: 'comments',
      id: unpackHmId('hm://uid1'),
      openComment: 'comment123',
      panel: null,
    })
    expect(createAppWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when requested', () => {
    const createAppWindow = vi.fn()

    const result = navigateDesktopUrl(
      'hm://uid1/:collaborators',
      {newWindow: true},
      {
        createAppWindow,
        getFocusedWindow: () => null,
      },
    )

    expect(result).toBe('Opened collaborators view in a new window.')
    expect(createAppWindow).toHaveBeenCalledWith({
      routes: [{key: 'collaborators', id: unpackHmId('hm://uid1'), panel: null}],
      routeIndex: 0,
    })
  })

  it('returns a visible error for non-hypermedia URLs', () => {
    const createAppWindow = vi.fn()

    const result = navigateDesktopUrl(
      'https://example.com/not-hypermedia',
      {},
      {
        createAppWindow,
        getFocusedWindow: () => null,
      },
    )

    expect(result).toBe('Error: Could not parse "https://example.com/not-hypermedia" as a Hypermedia route.')
    expect(createAppWindow).not.toHaveBeenCalled()
  })
})
