import type {
  HMCapability,
  HMListDocumentCollaboratorsOutput,
  HMSiteMember,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {getRenderedCollaboratorsCount} from '../collaborators-page'

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
