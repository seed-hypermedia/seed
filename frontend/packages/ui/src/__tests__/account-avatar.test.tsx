// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it, vi} from 'vitest'
import {AccountAvatar} from '../account-avatar'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useRouteLink: (route: {key: string; id: {uid: string}; accountUid?: string}) => ({
    href: `/${route.key}/${route.id.uid}/${route.accountUid || ''}`,
  }),
}))

vi.mock('../hm-icon', () => ({HMIcon: ({name}: {name?: string}) => <span data-avatar>{name}</span>}))
vi.mock('../hover-card', () => ({
  HoverCard: ({children}: {children: React.ReactNode}) => <>{children}</>,
  HoverCardTrigger: ({children}: {children: React.ReactNode}) => <>{children}</>,
  HoverCardContent: ({
    children,
    collisionPadding,
    className,
  }: {
    children: React.ReactNode
    collisionPadding?: number
    className?: string
  }) => (
    <aside data-collision-padding={collisionPadding} className={className}>
      {children}
    </aside>
  ),
}))

describe('AccountAvatar', () => {
  it('links the avatar and hover-card action to the global profile', () => {
    const html = renderToStaticMarkup(<AccountAvatar id={hmId('alice')} name="Alice" />)

    expect(html).toContain('aria-label="Open Alice profile"')
    expect(html.match(/href="\/profile\/alice\/"/g)).toHaveLength(2)
    expect(html).toContain('View profile')
  })

  it('uses the current site profile and an abbreviated id fallback', () => {
    const html = renderToStaticMarkup(<AccountAvatar id={hmId('z6Mkalice')} siteUid="team" />)

    expect(html).toContain('href="/site-profile/team/z6Mkalice"')
    expect(html).toContain('Open 6Mkalice profile')
  })

  it('keeps the hover card inside narrow viewport edges', () => {
    const html = renderToStaticMarkup(<AccountAvatar id={hmId('alice')} name="Alice" />)

    expect(html).toContain('data-collision-padding="12"')
    expect(html).toContain('max-w-[calc(100vw-1.5rem)]')
  })
})
