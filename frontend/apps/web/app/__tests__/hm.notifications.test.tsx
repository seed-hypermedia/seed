import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  useLocalKeyPairMock: vi.fn(),
  useWebAccountUidMock: vi.fn(),
  useWebNotificationInboxMock: vi.fn(),
  useWebNotificationReadStateMock: vi.fn(),
  useWebMarkNotificationEventReadMock: vi.fn(),
  useWebMarkNotificationEventUnreadMock: vi.fn(),
  useWebMarkAllNotificationsReadMock: vi.fn(),
  useUniversalAppContextMock: vi.fn(),
}))

vi.mock('@/auth', () => ({
  useLocalKeyPair: mocks.useLocalKeyPairMock,
}))

vi.mock('@/web-notifications', () => ({
  useWebAccountUid: mocks.useWebAccountUidMock,
  useWebNotificationInbox: mocks.useWebNotificationInboxMock,
  useWebNotificationReadState: mocks.useWebNotificationReadStateMock,
  useWebMarkNotificationEventRead: mocks.useWebMarkNotificationEventReadMock,
  useWebMarkNotificationEventUnread: mocks.useWebMarkNotificationEventUnreadMock,
  useWebMarkAllNotificationsRead: mocks.useWebMarkAllNotificationsReadMock,
}))

vi.mock('@remix-run/react', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@shm/shared', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared')>('@shm/shared')
  return {
    ...actual,
    routeToHref: () => '/',
    useUniversalAppContext: mocks.useUniversalAppContextMock,
  }
})

import {WebNotificationsPage} from '../notifications-page-content'

describe('WebNotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useWebAccountUidMock.mockReturnValue('account-1')
    mocks.useUniversalAppContextMock.mockReturnValue({
      origin: 'https://seed.example.com',
      originHomeId: {uid: 'site-1'},
    })
    mocks.useWebNotificationReadStateMock.mockReturnValue({
      data: undefined,
      error: null,
    })
    mocks.useWebMarkNotificationEventReadMock.mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isLoading: false,
    })
    mocks.useWebMarkNotificationEventUnreadMock.mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isLoading: false,
    })
    mocks.useWebMarkAllNotificationsReadMock.mockReturnValue({
      mutateAsync: vi.fn(),
      mutate: vi.fn(),
      isLoading: false,
    })
  })

  it('shows a relogin message when the session has no notify server URL', () => {
    mocks.useLocalKeyPairMock.mockReturnValue({
      id: 'account-1',
      notifyServerUrl: undefined,
    })

    const markup = renderToStaticMarkup(<WebNotificationsPage />)

    expect(markup).toContain('Notifications unavailable')
    expect(markup).toContain('Log out and log back in again to use notifications.')
    expect(markup).not.toContain('No notifications yet')
    expect(mocks.useWebNotificationInboxMock).not.toHaveBeenCalled()
    expect(mocks.useWebNotificationReadStateMock).not.toHaveBeenCalled()
    expect(mocks.useWebMarkNotificationEventReadMock).not.toHaveBeenCalled()
    expect(mocks.useWebMarkNotificationEventUnreadMock).not.toHaveBeenCalled()
    expect(mocks.useWebMarkAllNotificationsReadMock).not.toHaveBeenCalled()
  })

  it('shows the query error instead of the empty state when loading notifications fails', () => {
    mocks.useLocalKeyPairMock.mockReturnValue({
      id: 'session-key',
      delegatedAccountUid: 'account-1',
      notifyServerUrl: 'https://notify.example.com',
    })
    mocks.useWebNotificationInboxMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Signer session-key is not authorized to act on behalf of account account-1'),
    })

    const markup = renderToStaticMarkup(<WebNotificationsPage />)

    expect(markup).toContain('Could not load notifications')
    expect(markup).toContain('Signer session-key is not authorized to act on behalf of account account-1')
    expect(markup).not.toContain('No notifications yet')
  })

  it('passes the current site uid into notification hooks', () => {
    mocks.useLocalKeyPairMock.mockReturnValue({
      id: 'session-key',
      delegatedAccountUid: 'account-1',
      notifyServerUrl: 'https://notify.example.com',
    })
    mocks.useWebNotificationInboxMock.mockReturnValue({
      data: {
        accountId: 'account-1',
        notifications: [],
        hasMore: false,
        oldestEventAtMs: null,
      },
      isLoading: false,
      error: null,
    })

    renderToStaticMarkup(<WebNotificationsPage />)

    expect(mocks.useWebNotificationInboxMock).toHaveBeenCalledWith('site-1')
    expect(mocks.useWebNotificationReadStateMock).toHaveBeenCalledWith('site-1')
    expect(mocks.useWebMarkNotificationEventReadMock).toHaveBeenCalledWith('site-1')
    expect(mocks.useWebMarkNotificationEventUnreadMock).toHaveBeenCalledWith('site-1')
    expect(mocks.useWebMarkAllNotificationsReadMock).toHaveBeenCalledWith('site-1')
  })
})
