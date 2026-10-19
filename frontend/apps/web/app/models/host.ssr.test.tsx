import React from 'react'
import {renderToString} from 'react-dom/server'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {expect, it, vi} from 'vitest'
import {logoutHosting, useHostSession} from './host'

vi.mock('@shm/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/constants')>()),
  SEED_HOST_URL: 'https://hosting.example',
}))

it('SSR neither reads browser credentials nor fetches or revokes a visitor session', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const client = new QueryClient()
  function Consumer() {
    const session = useHostSession({includeSites: true})
    expect(session.isSessionLoaded).toBe(false)
    expect(session.loggedIn).toBe(false)
    expect(session.email).toBeNull()
    return <span>Signed out</span>
  }
  try {
    expect(
      renderToString(
        <QueryClientProvider client={client}>
          <Consumer />
        </QueryClientProvider>,
      ),
    ).toContain('Signed out')
    await logoutHosting()
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    client.clear()
    vi.unstubAllGlobals()
  }
})
