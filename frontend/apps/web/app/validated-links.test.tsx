// @vitest-environment jsdom
import React from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId, UniversalAppProvider, useValidatedWebRouteLink} from '@shm/shared'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  latestOpenUrl: null as null | ((url?: string, newWindow?: boolean) => Promise<void> | void),
}))

vi.mock('@/auth', () => ({
  useCreateAccount: vi.fn(),
}))

vi.mock('@shm/editor/comment-editor', () => ({
  CommentEditor: () => null,
}))

vi.mock('./email-notifications', () => ({
  EmailNotificationsForm: () => null,
}))

vi.mock('./local-db', () => ({
  hasPromptedEmailNotifications: false,
  setHasPromptedEmailNotifications: vi.fn(),
  setPendingIntent: vi.fn(),
}))

vi.mock('./pending-intent', () => ({
  processPendingIntent: vi.fn(),
}))

vi.mock('./web-perf-marks', () => ({
  isPerfEnabled: () => false,
  markCommentSubmitEnd: vi.fn(),
  markCommentSubmitStart: vi.fn(),
  markEditorLoadEnd: vi.fn(),
}))

import {useOpenUrlWeb} from './commenting'

function ValidatedLinkHarness({route}: {route: string}) {
  const linkProps = useValidatedWebRouteLink(route)
  return <a href={linkProps.href} data-seed-link={String(linkProps.isSeedLink)} />
}

function OpenUrlHarness() {
  mocks.latestOpenUrl = useOpenUrlWeb()
  return null
}

function createUniversalClient() {
  return {
    request: mocks.request,
    publish: vi.fn(),
  } as any
}

function renderHarness(node: React.ReactNode) {
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
        <UniversalAppProvider
          originHomeId={hmId('origin-site')}
          openUrl={vi.fn()}
          openRoute={vi.fn()}
          universalClient={createUniversalClient()}
        >
          {node}
        </UniversalAppProvider>
      </QueryClientProvider>,
    )
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
    await Promise.resolve()
  })
}

// Polls for a DOM state that only materializes after N rounds of async
// resolution (e.g. the 2-step `GetEntity → GetDomain` flow in
// `useValidatedWebRouteLink`). Fixed `await flushEffects()` counts race
// under CI load; this retries until the predicate passes or the budget
// is exhausted.
async function waitForHref(container: HTMLElement, expected: string, rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    const actual = container.querySelector('a')?.getAttribute('href')
    if (actual === expected) return
    await flushEffects()
  }
}

describe('validated web links', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mocks.request.mockReset()
    mocks.latestOpenUrl = null
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders a same-domain href for mismatched Seed domains', async () => {
    mocks.request.mockResolvedValue({registeredAccountUid: 'bob'})
    const route = 'https://alice.example/hm/alice/posts/:comments/comment123#blk1+'
    const {container, root} = renderHarness(<ValidatedLinkHarness route={route} />)

    await waitForHref(container, '/hm/alice/posts/:comments/comment123#blk1+')

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/hm/alice/posts/:comments/comment123#blk1+')
    expect(link?.getAttribute('data-seed-link')).toBe('true')
    expect(mocks.request).toHaveBeenCalledWith('GetDomain', {domain: 'alice.example', forceCheck: true})

    cleanupRendered(root, container)
  })

  it('keeps the external href when the destination Seed domain is verified', async () => {
    mocks.request.mockResolvedValue({registeredAccountUid: 'alice'})
    const route = 'https://alice.example/hm/alice/posts/:comments/comment123#blk1+'
    const {container, root} = renderHarness(<ValidatedLinkHarness route={route} />)

    await waitForHref(container, 'https://alice.example/posts/:comments/comment123#blk1+')

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://alice.example/posts/:comments/comment123#blk1+')

    cleanupRendered(root, container)
  })

  it('promotes hm links to the verified destination domain', async () => {
    mocks.request
      .mockResolvedValueOnce({id: {uid: 'alice'}, metadata: {siteUrl: 'https://alice.example'}})
      .mockResolvedValueOnce({registeredAccountUid: 'alice'})
    const route = 'hm://alice/posts/:comments/comment123#blk1+'
    const {container, root} = renderHarness(<ValidatedLinkHarness route={route} />)

    await waitForHref(container, 'https://alice.example/posts/:comments/comment123#blk1+')

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://alice.example/posts/:comments/comment123#blk1+')

    cleanupRendered(root, container)
  })

  it('uses the same-domain fallback URL when useOpenUrlWeb opens a new window', async () => {
    mocks.request
      .mockResolvedValueOnce({id: {uid: 'alice'}, metadata: {siteUrl: 'https://alice.example'}})
      .mockResolvedValueOnce({registeredAccountUid: 'bob'})
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const {container, root} = renderHarness(<OpenUrlHarness />)

    await act(async () => {
      await mocks.latestOpenUrl?.('hm://alice/posts/:comments/comment123#blk1+', true)
    })

    expect(openSpy).toHaveBeenCalledWith('/hm/alice/posts/:comments/comment123#blk1+', '_blank')

    cleanupRendered(root, container)
  })

  it('keeps the verified external URL when useOpenUrlWeb opens a new window', async () => {
    mocks.request
      .mockResolvedValueOnce({id: {uid: 'alice'}, metadata: {siteUrl: 'https://alice.example'}})
      .mockResolvedValueOnce({registeredAccountUid: 'alice'})
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const {container, root} = renderHarness(<OpenUrlHarness />)

    await act(async () => {
      await mocks.latestOpenUrl?.('hm://alice/posts/:comments/comment123#blk1+', true)
    })

    expect(openSpy).toHaveBeenCalledWith('https://alice.example/posts/:comments/comment123#blk1+', '_blank')

    cleanupRendered(root, container)
  })
})
