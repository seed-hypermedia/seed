// @vitest-environment jsdom
import React from 'react'
import type {
  HMCapability,
  HMListDocumentCollaboratorsOutput,
  HMSiteMember,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  errorToast: vi.fn(),
  mutate: vi.fn(),
  successToast: vi.fn(),
}))

const siteMembersState = vi.hoisted(() => ({
  value: {
    accounts: {} as HMListDocumentCollaboratorsOutput['accounts'],
    grantedMembers: [] as HMSiteMember[],
    isInitialLoading: false,
    members: [] as HMSiteMember[],
  },
}))

const selectedCapabilityState = vi.hoisted(() => ({
  value: null as HMCapability | null,
}))

vi.mock('@shm/shared', () => ({
  useUniversalAppContext: () => ({
    getOptimizedImageUrl: () => null,
    ipfsFileUrl: '',
  }),
  useRouteLink: () => ({href: '#profile'}),
}))

vi.mock('@shm/shared/models/capabilities', () => ({
  useAddCapabilities: () => ({
    isLoading: false,
    mutate: mocks.mutate,
  }),
  useSelectedAccountCapability: () => selectedCapabilityState.value,
}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: null}),
  useCapabilities: () => ({data: []}),
  useCollaborators: () => ({
    accounts: {},
    parentCapabilities: [],
    grantedCapabilities: [],
    publisherUid: 'publisher',
    isInitialLoading: false,
  }),
  useResource: () => ({data: null}),
  useSelectedAccountId: () => 'publisher',
  useSiteMembers: () => siteMembersState.value,
}))

vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: []}}),
}))

vi.mock('../hm-icon', () => ({
  HMIcon: () => null,
  LoadedHMIcon: () => null,
}))

vi.mock('../toast', () => ({
  toast: {
    error: mocks.errorToast,
    success: mocks.successToast,
  },
}))

import {CollaboratorsPage, getRenderedCollaboratorsCount} from '../collaborators-page'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.mutate.mockReset()
  mocks.successToast.mockReset()
  mocks.errorToast.mockReset()
  selectedCapabilityState.value = null
  siteMembersState.value = {
    accounts: {},
    grantedMembers: [],
    isInitialLoading: false,
    members: [],
  }
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function id(uid: string, path: string[] | null = null): UnpackedHypermediaId {
  return {
    id: path?.length ? `${uid}/${path.join('/')}` : uid,
    uid,
    path,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  }
}

function account(uid: string): HMListDocumentCollaboratorsOutput['accounts'][string] {
  return {
    id: id(uid),
    metadata: {name: uid},
  }
}

function capability(accountUid: string, grantId: UnpackedHypermediaId): HMCapability {
  return {
    id: `${accountUid}-${grantId.id}`,
    accountUid,
    role: 'writer',
    grantId,
    createTime: {seconds: 0, nanos: 0},
  }
}

function member(accountUid: string): HMSiteMember {
  return {
    account: id(accountUid),
    role: 'member',
  }
}

function collaborators(overrides: Partial<HMListDocumentCollaboratorsOutput> = {}): HMListDocumentCollaboratorsOutput {
  return {
    publisherUid: 'publisher',
    parentCapabilities: [],
    grantedCapabilities: [],
    grantedMembers: [],
    members: [],
    accounts: {publisher: account('publisher')},
    ...overrides,
  }
}

describe('getRenderedCollaboratorsCount', () => {
  it('returns 0 while collaborator data is unavailable', () => {
    expect(getRenderedCollaboratorsCount(null, false)).toBe(0)
    expect(getRenderedCollaboratorsCount(undefined, true)).toBe(0)
  })

  it('counts the publisher and visible capability rows for document pages', () => {
    const parentGrant = id('publisher')
    const directGrant = id('publisher', ['guide'])

    expect(
      getRenderedCollaboratorsCount(
        collaborators({
          parentCapabilities: [capability('parent-writer', parentGrant)],
          grantedCapabilities: [capability('direct-writer', directGrant)],
          grantedMembers: [member('site-member')],
          members: [member('subscriber')],
          accounts: {
            publisher: account('publisher'),
            'parent-writer': account('parent-writer'),
            'direct-writer': account('direct-writer'),
            'site-member': account('site-member'),
            subscriber: account('subscriber'),
          },
        }),
        false,
      ),
    ).toBe(3)
  })

  it('counts the publisher and visible member rows for site root pages', () => {
    expect(
      getRenderedCollaboratorsCount(
        collaborators({
          parentCapabilities: [capability('parent-writer', id('publisher'))],
          grantedCapabilities: [capability('direct-writer', id('publisher'))],
          grantedMembers: [member('site-writer')],
          members: [member('subscriber')],
          accounts: {
            publisher: account('publisher'),
            'parent-writer': account('parent-writer'),
            'direct-writer': account('direct-writer'),
            'site-writer': account('site-writer'),
            subscriber: account('subscriber'),
          },
        }),
        true,
      ),
    ).toBe(3)
  })

  it('excludes non-publisher people whose metadata is absent because the list does not render them', () => {
    expect(
      getRenderedCollaboratorsCount(
        collaborators({
          parentCapabilities: [
            capability('visible-parent', id('publisher')),
            capability('missing-parent', id('publisher')),
          ],
          grantedCapabilities: [capability('visible-direct', id('publisher', ['guide']))],
          grantedMembers: [member('visible-site-writer'), member('missing-site-writer')],
          members: [member('visible-subscriber'), member('missing-subscriber')],
          accounts: {
            publisher: account('publisher'),
            'visible-parent': account('visible-parent'),
            'visible-direct': account('visible-direct'),
            'visible-site-writer': account('visible-site-writer'),
            'visible-subscriber': account('visible-subscriber'),
          },
        }),
        false,
      ),
    ).toBe(3)
  })
})

describe('site member writer promotion', () => {
  it('renders a visible owner-only Add as writer button for regular site members', () => {
    selectedCapabilityState.value = capability('publisher', id('publisher'))
    siteMembersState.value = {
      accounts: {
        publisher: account('publisher'),
        member: account('member'),
        writer: account('writer'),
      },
      grantedMembers: [{account: id('writer'), role: 'writer'}],
      isInitialLoading: false,
      members: [{account: id('member'), role: 'member'}],
    }

    act(() => {
      root.render(React.createElement(CollaboratorsPage, {docId: id('publisher')}))
    })

    expect(container.textContent).toContain('member')
    expect(container.textContent).toContain('writer')
    expect(container.querySelector('button')?.textContent).toContain('Add as writer')
    expect(container.textContent?.match(/Add as writer/g)).toHaveLength(1)
  })

  it('does not render Add as writer for non-owners', () => {
    selectedCapabilityState.value = null
    siteMembersState.value = {
      accounts: {
        publisher: account('publisher'),
        member: account('member'),
      },
      grantedMembers: [],
      isInitialLoading: false,
      members: [{account: id('member'), role: 'member'}],
    }

    act(() => {
      root.render(React.createElement(CollaboratorsPage, {docId: id('publisher')}))
    })

    expect(container.textContent).toContain('member')
    expect(container.textContent).not.toContain('Add as writer')
  })

  it('promotes the member to writer and shows a success toast after capability creation succeeds', () => {
    selectedCapabilityState.value = capability('publisher', id('publisher'))
    siteMembersState.value = {
      accounts: {
        publisher: account('publisher'),
        member: account('member'),
      },
      grantedMembers: [],
      isInitialLoading: false,
      members: [{account: id('member'), role: 'member'}],
    }
    mocks.mutate.mockImplementation((_vars, options) => options?.onSuccess?.())

    act(() => {
      root.render(React.createElement(CollaboratorsPage, {docId: id('publisher')}))
    })

    act(() => {
      container.querySelector<HTMLButtonElement>('button')?.click()
    })

    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        myCapability: selectedCapabilityState.value,
        collaboratorAccountIds: ['member'],
        role: 'WRITER',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )
    expect(mocks.successToast).toHaveBeenCalledWith('Writer access granted')
  })

  it('keeps the row link on the profile name instead of wrapping the whole row', () => {
    selectedCapabilityState.value = capability('publisher', id('publisher'))
    siteMembersState.value = {
      accounts: {
        publisher: account('publisher'),
        member: account('member'),
      },
      grantedMembers: [],
      isInitialLoading: false,
      members: [{account: id('member'), role: 'member'}],
    }

    act(() => {
      root.render(React.createElement(CollaboratorsPage, {docId: id('publisher')}))
    })

    const profileLink = Array.from(container.querySelectorAll('a')).find((link) => link.textContent === 'member')
    expect(profileLink).toBeTruthy()
    expect(profileLink?.querySelector('button')).toBeNull()
  })

  it('places the Add as writer button before the capability label and keeps the profile name truncatable', () => {
    selectedCapabilityState.value = capability('publisher', id('publisher'))
    siteMembersState.value = {
      accounts: {
        publisher: account('publisher'),
        member: account('member'),
      },
      grantedMembers: [],
      isInitialLoading: false,
      members: [{account: id('member'), role: 'member'}],
    }

    act(() => {
      root.render(React.createElement(CollaboratorsPage, {docId: id('publisher')}))
    })

    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent?.includes('Add as writer'),
    )
    const profileLink = Array.from(container.querySelectorAll('a')).find((link) => link.textContent === 'member')

    expect(button?.nextElementSibling?.textContent).toBe('Member')
    expect(profileLink?.className).toContain('min-w-0')
    expect(profileLink?.className).toContain('flex-1')
    expect(profileLink?.className).toContain('truncate')
  })
})
