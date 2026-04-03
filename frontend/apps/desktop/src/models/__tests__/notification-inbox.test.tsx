import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {getLocalInboxQueryMock} = vi.hoisted(() => ({
  getLocalInboxQueryMock: vi.fn(),
}))

vi.mock('@/trpc', () => ({
  client: {
    notificationInbox: {
      getLocalInbox: {
        query: getLocalInboxQueryMock,
      },
    },
  },
}))

import {useNotificationInbox} from '../notification-inbox'

function TestNotificationInbox({accountUid}: {accountUid: string}) {
  useNotificationInbox(accountUid)
  return null
}

function renderNotificationInbox(accountUid: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <TestNotificationInbox accountUid={accountUid} />
      </QueryClientProvider>,
    )
  })

  return {container, root, queryClient}
}

function cleanupRendered(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  act(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useNotificationInbox', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    getLocalInboxQueryMock.mockReset()
    getLocalInboxQueryMock.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls the local inbox every five seconds', async () => {
    const rendered = renderNotificationInbox('account-1')

    try {
      await flushAsyncWork()
      expect(getLocalInboxQueryMock).toHaveBeenCalledTimes(1)
      expect(getLocalInboxQueryMock).toHaveBeenLastCalledWith({accountUid: 'account-1'})

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(getLocalInboxQueryMock).toHaveBeenCalledTimes(2)
    } finally {
      cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    }
  })

  it('refetches the inbox when the window regains focus', async () => {
    const rendered = renderNotificationInbox('account-1')

    try {
      await flushAsyncWork()
      expect(getLocalInboxQueryMock).toHaveBeenCalledTimes(1)

      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await Promise.resolve()
      })

      expect(getLocalInboxQueryMock).toHaveBeenCalledTimes(2)
    } finally {
      cleanupRendered(rendered.root, rendered.container, rendered.queryClient)
    }
  })
})
