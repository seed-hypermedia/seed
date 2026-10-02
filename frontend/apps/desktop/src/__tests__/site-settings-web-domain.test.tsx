import {hmId} from '@shm/shared'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mockState = vi.hoisted(() => ({
  siteUrl: undefined as string | undefined,
  role: 'writer' as string | undefined,
  pendingDomains: [] as Array<{siteUid: string; hostname: string}>,
  openPublish: vi.fn(),
  openRemove: vi.fn(),
}))

vi.mock('@/components/publish-site', () => ({
  usePublishSite: () => ({open: mockState.openPublish, content: null}),
  useRemoveSiteDialog: () => ({open: mockState.openRemove, content: null}),
}))

vi.mock('@/models/access-control', () => ({
  useSelectedAccountCapability: () => (mockState.role ? {role: mockState.role} : null),
  roleCanWrite: (role?: string) => role === 'writer' || role === 'owner',
}))

vi.mock('@/models/gateway-settings', () => ({
  useGatewayUrl: () => ({data: 'https://hyper.media'}),
}))

vi.mock('@/models/host', () => ({
  useHostSession: () => ({pendingDomains: mockState.pendingDomains}),
}))

vi.mock('@/open-url', () => ({
  useOpenUrl: () => vi.fn(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({
    isInitialLoading: false,
    data: {type: 'document', document: {metadata: {name: 'My Space', siteUrl: mockState.siteUrl}}},
  }),
}))

import {WebDomainSettings} from '../components/site-settings-web-domain'

const siteId = hmId('z6MkTestAccount')
let root: Root
let container: HTMLDivElement

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<WebDomainSettings siteId={siteId} />)
  })
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.includes(label),
  )
  expect(button, `button "${label}"`).toBeDefined()
  act(() => {
    button!.click()
  })
}

describe('WebDomainSettings', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.siteUrl = undefined
    mockState.role = 'writer'
    mockState.pendingDomains = []
    mockState.openPublish.mockReset()
    mockState.openRemove.mockReset()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('offers to publish a space that has no web domain', () => {
    render()

    expect(container.textContent).not.toContain('Remove Domain from Publication')
    click('Publish to Web Domain')
    expect(mockState.openPublish).toHaveBeenCalledWith({id: siteId})
  })

  it('removes the domain of a published space', () => {
    mockState.siteUrl = 'https://myspace.hyper.media'
    render()

    expect(container.textContent).toContain('myspace.hyper.media')
    expect(container.textContent).not.toContain('Publish to Web Domain')
    click('Remove Domain from Publication')
    expect(mockState.openRemove).toHaveBeenCalledWith(siteId)
  })

  it('offers a custom domain only for a space on the free subdomain', () => {
    mockState.siteUrl = 'https://myspace.hyper.media'
    render()
    click('Publish Custom Domain')
    expect(mockState.openPublish).toHaveBeenCalledWith({id: siteId, step: 'seed-host-custom-domain'})
    act(() => {
      root.unmount()
    })
    container.remove()

    mockState.siteUrl = 'https://example.com'
    render()
    expect(container.textContent).not.toContain('Publish Custom Domain')
    expect(container.textContent).toContain('Remove Domain from Publication')
  })

  it('shows no actions to someone who cannot edit the space', () => {
    mockState.role = undefined
    mockState.siteUrl = 'https://myspace.hyper.media'
    render()

    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
