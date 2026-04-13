import {decode as cborDecode} from '@ipld/dag-cbor'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {applyNotificationActions} from '../notification-service'
import {getNotificationInbox} from '../notifications'

describe('notification state requests', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the canonical notification state with an explicit 400 item inbox limit', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          accountId: 'account-1',
          inbox: {
            notifications: [],
            hasMore: false,
            oldestEventAtMs: null,
          },
          config: {
            accountId: 'account-1',
            email: null,
            verifiedTime: null,
            verificationSendTime: null,
            verificationExpired: false,
          },
          readState: {
            accountId: 'account-1',
            markAllReadAtMs: null,
            readEvents: [],
            updatedAt: new Date(0).toISOString(),
          },
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      ),
    )

    await getNotificationInbox('https://notify.example', {
      publicKey: new Uint8Array([1, 2, 3]),
      sign: async () => new Uint8Array([4, 5, 6]),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = cborDecode(init.body as Uint8Array) as {
      action: string
      limit?: number
      beforeMs?: number
    }

    expect(url).toBe('https://notify.example/hm/api/notifications')
    expect(payload.action).toBe('get-notification-state')
    expect(payload.limit).toBe(400)
    expect(payload.beforeMs).toBeUndefined()
  })

  it('includes siteUid in site-scoped inbox requests', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          accountId: 'account-1',
          inbox: {
            notifications: [],
            hasMore: false,
            oldestEventAtMs: null,
          },
          config: {
            accountId: 'account-1',
            email: null,
            verifiedTime: null,
            verificationSendTime: null,
            verificationExpired: false,
          },
          readState: {
            accountId: 'account-1',
            markAllReadAtMs: null,
            readEvents: [],
            updatedAt: new Date(0).toISOString(),
          },
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      ),
    )

    await getNotificationInbox(
      'https://notify.example',
      {
        publicKey: new Uint8Array([1, 2, 3]),
        sign: async () => new Uint8Array([4, 5, 6]),
      },
      {siteUid: 'site-1'},
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = cborDecode(init.body as Uint8Array) as {
      action: string
      siteUid?: string
    }

    expect(payload.action).toBe('get-notification-state')
    expect(payload.siteUid).toBe('site-1')
  })

  it('encodes site-scoped mark-all actions on the unified notifications route', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          accountId: 'account-1',
          inbox: {
            notifications: [],
            hasMore: false,
            oldestEventAtMs: null,
          },
          config: {
            accountId: 'account-1',
            email: null,
            verifiedTime: null,
            verificationSendTime: null,
            verificationExpired: false,
          },
          readState: {
            accountId: 'account-1',
            markAllReadAtMs: null,
            readEvents: [],
            updatedAt: new Date(0).toISOString(),
          },
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      ),
    )

    await applyNotificationActions(
      'https://notify.example',
      {
        publicKey: new Uint8Array([1, 2, 3]),
        sign: async () => new Uint8Array([4, 5, 6]),
      },
      {
        siteUid: 'site-1',
        actions: [{type: 'mark-site-read', siteUid: 'site-1'}],
      },
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = cborDecode(init.body as Uint8Array) as {
      action: string
      siteUid?: string
      actions?: Array<{type: string; siteUid?: string}>
    }

    expect(payload.action).toBe('apply-notification-actions')
    expect(payload.siteUid).toBe('site-1')
    expect(payload.actions).toEqual([{type: 'mark-site-read', siteUid: 'site-1'}])
  })
})
