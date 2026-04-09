import {decode as cborDecode} from '@ipld/dag-cbor'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import {AccountNotificationsSection} from './AccountNotificationsSection'

type NotificationState = {
  accountId: string
  email: string | null
  verifiedTime: string | null
  verificationSendTime: string | null
  verificationExpired: boolean
  isRegistered: boolean
}

function createJsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {'Content-Type': 'application/json'},
  })
}

function createNotificationFetchMock(
  initialState: Partial<NotificationState> = {},
  options?: {configReadsBeforeRegistrationVisible?: number},
) {
  const state: NotificationState = {
    accountId: 'account-1',
    email: null,
    verifiedTime: null,
    verificationSendTime: null,
    verificationExpired: false,
    isRegistered: false,
    ...initialState,
  }
  let pendingRegistrationConfigReads = 0
  const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body as Uint8Array | undefined
    const decoded = body ? (cborDecode(body) as {action: string; email?: string}) : null

    if (url.endsWith('/hm/api/notification-config')) {
      if (!decoded || decoded.action === 'get-notification-config') {
        if (pendingRegistrationConfigReads > 0) {
          pendingRegistrationConfigReads -= 1
          return createJsonResponse({
            ...state,
            isRegistered: false,
          })
        }
        return createJsonResponse(state)
      }

      if (decoded.action === 'set-notification-config') {
        state.email = decoded.email ?? null
        state.verifiedTime = null
        state.verificationSendTime = '2026-04-01T08:00:00.000Z'
        state.verificationExpired = false
        return createJsonResponse({
          success: true,
          ...state,
        })
      }

      if (decoded.action === 'remove-notification-config') {
        state.email = null
        state.verifiedTime = null
        state.verificationSendTime = null
        state.verificationExpired = false
        return createJsonResponse({
          success: true,
          ...state,
        })
      }
    }

    if (url.endsWith('/hm/api/notification-inbox')) {
      state.isRegistered = true
      pendingRegistrationConfigReads = options?.configReadsBeforeRegistrationVisible ?? 0
      return createJsonResponse({registered: true})
    }

    return new Response(JSON.stringify({error: 'Unhandled request'}), {status: 404})
  })

  return {fetchMock}
}

function findRequestPayload(fetchMock: ReturnType<typeof mock>, action: string) {
  for (const [, request] of fetchMock.mock.calls) {
    const body = request?.body as Uint8Array | undefined
    if (!body) continue
    const payload = cborDecode(body) as {action?: string}
    if (payload.action === action) {
      return payload
    }
  }
  return null
}

function countRequestPayloads(fetchMock: ReturnType<typeof mock>, action: string) {
  return fetchMock.mock.calls.filter(([, request]) => {
    const body = request?.body as Uint8Array | undefined
    if (!body) return false
    const payload = cborDecode(body) as {action?: string}
    return payload.action === action
  }).length
}

describe('AccountNotificationsSection', () => {
  afterEach(() => {
    cleanup()
  })

  const seed = new Uint8Array(32).fill(9)

  test('shows a register button when the account is not registered', async () => {
    const originalFetch = global.fetch
    const {fetchMock} = createNotificationFetchMock()
    global.fetch = fetchMock as unknown as typeof fetch

    try {
      render(
        <AccountNotificationsSection
          seed={seed}
          accountCreateTime={0}
          notificationServerUrl="https://notify.example.com"
          sessionEmail="test@example.com"
        />,
      )

      await waitFor(() => {
        expect(screen.getByRole('button', {name: 'Register Account'})).toBeDefined()
      })
      expect(screen.queryByRole('button', {name: 'Set Notification Email'})).toBeNull()
    } finally {
      global.fetch = originalFetch
    }
  })

  test('shows a set email button after registering without an email', async () => {
    const originalFetch = global.fetch
    const {fetchMock} = createNotificationFetchMock({}, {configReadsBeforeRegistrationVisible: 1})
    global.fetch = fetchMock as unknown as typeof fetch

    try {
      render(
        <AccountNotificationsSection
          seed={seed}
          accountCreateTime={0}
          notificationServerUrl="https://notify.example.com"
          sessionEmail="test@example.com"
        />,
      )

      await waitFor(() => {
        expect((screen.getByRole('button', {name: 'Register Account'}) as HTMLButtonElement).disabled).toBe(false)
      })

      fireEvent.click(screen.getByRole('button', {name: 'Register Account'}))

      await waitFor(() => {
        expect(screen.getByText('Registering this account with notify.example.com...')).toBeDefined()
      })

      await waitFor(() => {
        expect(screen.getByRole('button', {name: 'Set Notification Email'})).toBeDefined()
      })
      expect(screen.getByText('This account is registered with notify.example.com.')).toBeDefined()
      expect(countRequestPayloads(fetchMock, 'get-notification-config')).toBeGreaterThanOrEqual(3)
      expect(findRequestPayload(fetchMock, 'register-inbox')).toEqual(
        expect.objectContaining({
          action: 'register-inbox',
        }),
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  test('sets and displays the vault session email once the account is registered', async () => {
    const originalFetch = global.fetch
    const {fetchMock} = createNotificationFetchMock({
      isRegistered: true,
    })
    global.fetch = fetchMock as unknown as typeof fetch

    try {
      render(
        <AccountNotificationsSection
          seed={seed}
          accountCreateTime={0}
          notificationServerUrl="https://notify.example.com"
          sessionEmail="test@example.com"
        />,
      )

      await waitFor(() => {
        expect(screen.getByRole('button', {name: 'Set Notification Email'})).toBeDefined()
      })

      fireEvent.click(screen.getByRole('button', {name: 'Set Notification Email'}))

      await waitFor(() => {
        expect(screen.getByText('test@example.com')).toBeDefined()
      })
      expect(screen.queryByLabelText('Notification Email')).toBeNull()
      expect(screen.getByText('This account is registered with notify.example.com.')).toBeDefined()
      expect(screen.queryByRole('button', {name: 'Edit Email'})).toBeNull()
      expect(findRequestPayload(fetchMock, 'set-notification-config')).toEqual(
        expect.objectContaining({
          action: 'set-notification-config',
          email: 'test@example.com',
        }),
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  test('removes the notification email and returns to the set email state', async () => {
    const originalFetch = global.fetch
    const {fetchMock} = createNotificationFetchMock({
      isRegistered: true,
      email: 'notify@example.com',
      verifiedTime: '2026-04-01T08:00:00.000Z',
    })
    global.fetch = fetchMock as unknown as typeof fetch

    try {
      render(
        <AccountNotificationsSection
          seed={seed}
          accountCreateTime={0}
          notificationServerUrl="https://notify.example.com"
          sessionEmail="test@example.com"
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('notify@example.com')).toBeDefined()
      })

      fireEvent.click(screen.getByRole('button', {name: 'Remove Email'}))

      await waitFor(() => {
        expect(screen.getByRole('button', {name: 'Set Notification Email'})).toBeDefined()
      })
      expect(findRequestPayload(fetchMock, 'remove-notification-config')).toEqual(
        expect.objectContaining({
          action: 'remove-notification-config',
        }),
      )
    } finally {
      global.fetch = originalFetch
    }
  })

  test('polls quickly while verification is pending and updates when verification completes', async () => {
    const originalFetch = global.fetch
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    let getConfigCount = 0
    const {fetchMock} = createNotificationFetchMock({
      isRegistered: true,
      email: 'notify@example.com',
      verifiedTime: null,
      verificationSendTime: '2026-04-01T08:00:00.000Z',
    })
    const pollingFetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as Uint8Array | undefined
      const decoded = body ? (cborDecode(body) as {action?: string}) : null

      if (decoded?.action === 'get-notification-config') {
        getConfigCount += 1
        if (getConfigCount >= 2) {
          return createJsonResponse({
            accountId: 'account-1',
            email: 'notify@example.com',
            verifiedTime: '2026-04-01T08:05:00.000Z',
            verificationSendTime: '2026-04-01T08:00:00.000Z',
            verificationExpired: false,
            isRegistered: true,
          })
        }
      }

      return fetchMock(input, init)
    })
    const setIntervalMock = mock((callback: TimerHandler) => {
      return window.setTimeout(() => {
        ;(callback as () => void)()
      }, 10) as unknown as number
    })
    const clearIntervalMock = mock((timerId?: number) => {
      if (timerId != null) {
        window.clearTimeout(timerId)
      }
    })
    global.fetch = pollingFetchMock as unknown as typeof fetch
    window.setInterval = setIntervalMock as unknown as typeof window.setInterval
    window.clearInterval = clearIntervalMock as unknown as typeof window.clearInterval

    try {
      render(
        <AccountNotificationsSection
          seed={seed}
          accountCreateTime={0}
          notificationServerUrl="https://notify.example.com"
          sessionEmail="test@example.com"
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('Verification pending')).toBeDefined()
      })

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 50))
      })

      await waitFor(() => {
        expect(screen.queryByText('Verification pending')).toBeNull()
        expect(countRequestPayloads(pollingFetchMock, 'get-notification-config')).toBeGreaterThanOrEqual(2)
      })
      expect(setIntervalMock).toHaveBeenCalled()
    } finally {
      global.fetch = originalFetch
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
    }
  })

  test('polls recent account registrations before showing the unregistered state', async () => {
    const originalFetch = global.fetch
    const originalSetInterval = window.setInterval
    const originalClearInterval = window.clearInterval
    let getConfigCount = 0
    const {fetchMock} = createNotificationFetchMock()
    const pollingFetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as Uint8Array | undefined
      const decoded = body ? (cborDecode(body) as {action?: string}) : null

      if (decoded?.action === 'get-notification-config') {
        getConfigCount += 1
        if (getConfigCount >= 2) {
          return createJsonResponse({
            accountId: 'account-1',
            email: null,
            verifiedTime: null,
            verificationSendTime: null,
            verificationExpired: false,
            isRegistered: true,
          })
        }
      }

      return fetchMock(input, init)
    })
    const setIntervalMock = mock((callback: TimerHandler) => {
      return window.setTimeout(() => {
        ;(callback as () => void)()
      }, 10) as unknown as number
    })
    const clearIntervalMock = mock((timerId?: number) => {
      if (timerId != null) {
        window.clearTimeout(timerId)
      }
    })
    global.fetch = pollingFetchMock as unknown as typeof fetch
    window.setInterval = setIntervalMock as unknown as typeof window.setInterval
    window.clearInterval = clearIntervalMock as unknown as typeof window.clearInterval

    try {
      render(
        <AccountNotificationsSection
          seed={seed}
          accountCreateTime={Date.now()}
          notificationServerUrl="https://notify.example.com"
          sessionEmail="test@example.com"
        />,
      )

      expect(screen.getByText('Registering this account with notify.example.com.')).toBeDefined()
      expect(screen.getByText('Registering this account with notify.example.com...')).toBeDefined()

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 50))
      })

      await waitFor(() => {
        expect(screen.getByText('This account is registered with notify.example.com.')).toBeDefined()
        expect(screen.getByRole('button', {name: 'Set Notification Email'})).toBeDefined()
        expect(countRequestPayloads(pollingFetchMock, 'get-notification-config')).toBeGreaterThanOrEqual(2)
      })
    } finally {
      global.fetch = originalFetch
      window.setInterval = originalSetInterval
      window.clearInterval = originalClearInterval
    }
  })
})
