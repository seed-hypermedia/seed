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

import {WebNotificationsPage} from '../notifications-page-content'

describe('WebNotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useWebAccountUidMock.mockReturnValue('account-1')
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
})
