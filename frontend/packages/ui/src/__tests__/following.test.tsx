// @vitest-environment jsdom
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {FollowingContent} from '../following'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

const state = vi.hoisted(() => ({
  viewerContacts: [] as {subject: string; name: string; subscribe?: {profile?: boolean; site?: boolean}}[],
}))
vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useContactListOfAccount: () => ({
    data: [{id: 'contact', subject: 'alice', name: 'Someone else’s nickname', subscribe: {profile: true}}],
  }),
  useRouteLink: (route: {key: string}) => ({href: `/${route.key}`}),
}))
vi.mock('@shm/shared/models/contacts', () => ({useSelectedAccountContacts: () => ({data: state.viewerContacts})}))
vi.mock('@shm/shared/models/entity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/models/entity')>()),
  useAccountsMetadata: () => ({data: {alice: {metadata: {name: 'Public Alice'}}}}),
}))
vi.mock('../hm-icon', () => ({HMIcon: () => null}))

beforeEach(() => {
  state.viewerContacts = []
})
describe('FollowingContent viewer names', () => {
  it('never uses the viewed account’s contact names', () => {
    const html = renderToStaticMarkup(<FollowingContent accountUid="someone-else" />)
    expect(html).toContain('Public Alice')
    expect(html).not.toContain('Someone else’s nickname')
    expect(html).toContain('href="/profile"')
  })
  it('shows the viewer’s followed contact name alongside the public identity', () => {
    state.viewerContacts = [{subject: 'alice', name: 'My Ally', subscribe: {profile: true}}]
    const html = renderToStaticMarkup(<FollowingContent accountUid="someone-else" />)
    expect(html).toContain('My Ally')
    expect(html).toContain('Public Alice')
  })
  it('supports legacy following contacts but not site-only subscriptions', () => {
    state.viewerContacts = [{subject: 'alice', name: 'Legacy Ally'}]
    expect(renderToStaticMarkup(<FollowingContent accountUid="someone-else" />)).toContain('Legacy Ally')
    state.viewerContacts = [{subject: 'alice', name: 'Site name', subscribe: {site: true}}]
    expect(renderToStaticMarkup(<FollowingContent accountUid="someone-else" />)).not.toContain('Site name')
  })
})
