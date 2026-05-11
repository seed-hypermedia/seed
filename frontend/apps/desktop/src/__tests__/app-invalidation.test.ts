import {beforeEach, describe, expect, it, vi} from 'vitest'

const getAllWindowsMock = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}))

describe('app invalidation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('broadcasts invalidated query keys directly to every live BrowserWindow', async () => {
    const sendA = vi.fn()
    const sendB = vi.fn()
    const sendDestroyed = vi.fn()
    const queryKey = ['NOTIFICATION_READ_STATE', 'account-1']

    getAllWindowsMock.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: sendA,
        },
      },
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: sendB,
        },
      },
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => true,
          send: sendDestroyed,
        },
      },
    ])

    const {appInvalidateQueries} = await import('../app-invalidation')

    appInvalidateQueries(queryKey)

    expect(sendA).toHaveBeenCalledWith('query_invalidation', queryKey)
    expect(sendB).toHaveBeenCalledWith('query_invalidation', queryKey)
    expect(sendDestroyed).not.toHaveBeenCalled()
  })
})
