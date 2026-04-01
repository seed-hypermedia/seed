import type {PropsWithChildren} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  useLoaderDataMock: vi.fn(),
}))

vi.mock('@remix-run/react', () => ({
  useLoaderData: mocks.useLoaderDataMock,
}))

vi.mock('@/wrapping', () => ({
  unwrap: <T,>(value: T) => value,
}))

vi.mock('@/providers', () => ({
  WebSiteProvider: ({children}: PropsWithChildren) => <>{children}</>,
  NavigationLoadingContent: ({children, className}: PropsWithChildren<{className?: string}>) => (
    <div data-navigation-loading-content={className}>{children}</div>
  ),
  getOptimizedImageUrl: () => null,
}))

vi.mock('@/page-footer', () => ({
  PageFooter: ({className}: {className?: string}) => <div data-page-footer-class={className} />,
}))

vi.mock('@/web-site-header', () => ({
  WebSiteHeader: () => <div data-web-site-header="true" />,
}))

vi.mock('@/client-lazy', () => ({
  ClientOnly: ({children}: PropsWithChildren) => <>{children}</>,
}))

vi.mock('@/notifications-page-content', () => ({
  WebNotificationsPage: () => <div data-web-notifications-page="true" />,
}))

vi.mock('@/web-utils', () => ({
  WebAccountFooter: ({children}: PropsWithChildren) => <>{children}</>,
}))

import NotificationsRoute from '../routes/hm.notifications'

describe('NotificationsRoute', () => {
  beforeEach(() => {
    mocks.useLoaderDataMock.mockReturnValue({
      originHomeId: {uid: 'site-1'},
      siteHost: 'seed.example.com',
      origin: 'https://seed.example.com',
      homeMetadata: null,
      dehydratedState: null,
    })
  })

  it('passes a full-width class to the page footer', () => {
    const markup = renderToStaticMarkup(<NotificationsRoute />)

    expect(markup).toContain('data-page-footer-class="w-full"')
  })
})
