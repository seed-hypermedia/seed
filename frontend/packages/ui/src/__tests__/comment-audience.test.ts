import type {HMListDocumentCollaboratorsOutput} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {getRenderedCollaboratorsCount} from '../collaborators-page'
import {getCommentAudienceAccountUids} from '../members-facepile'

const collaborators: HMListDocumentCollaboratorsOutput = {
  publisherUid: 'owner',
  parentCapabilities: Array.from({length: 11}, (_, index) => ({
    id: `grant-${index}`,
    accountUid: `writer-${index}`,
    role: 'writer',
    grantId: hmId('owner'),
    createTime: {seconds: 0, nanos: 0},
  })),
  grantedCapabilities: [],
  grantedMembers: Array.from({length: 11}, (_, index) => ({account: hmId(`writer-${index}`), role: 'writer'})),
  members: Array.from({length: 30}, (_, index) => ({account: hmId(`subscriber-${index}`), role: 'member'})),
  accounts: Object.fromEntries(
    [
      'owner',
      ...Array.from({length: 11}, (_, i) => `writer-${i}`),
      ...Array.from({length: 30}, (_, i) => `subscriber-${i}`),
    ].map((uid) => [uid, {id: hmId(uid), metadata: null}]),
  ),
}

describe('comment audience matches the People list', () => {
  it('uses 12 document collaborators instead of 42 space members on a nested document', () => {
    const accounts = getCommentAudienceAccountUids(collaborators, false)
    expect(getRenderedCollaboratorsCount(collaborators, false)).toBe(12)
    expect(accounts).toEqual(['owner', ...collaborators.parentCapabilities.map((cap) => cap.accountUid)])
    expect(accounts).toHaveLength(getRenderedCollaboratorsCount(collaborators, false))
  })

  it('includes subscribers at the space root, matching the root People list', () => {
    const accounts = getCommentAudienceAccountUids(collaborators, true)
    expect(getRenderedCollaboratorsCount(collaborators, true)).toBe(42)
    expect(accounts).toHaveLength(getRenderedCollaboratorsCount(collaborators, true))
    expect(accounts).toContain('subscriber-0')
  })

  it('includes direct writers as well as inherited writers', () => {
    const data = {
      ...collaborators,
      parentCapabilities: collaborators.parentCapabilities.slice(0, 10),
      grantedCapabilities: collaborators.parentCapabilities.slice(10),
    }
    expect(getCommentAudienceAccountUids(data, false)).toHaveLength(getRenderedCollaboratorsCount(data, false))
    expect(getCommentAudienceAccountUids(data, false)).toContain('writer-10')
  })

  it('uses the same account availability filter as the People list', () => {
    const data = {...collaborators, accounts: {owner: collaborators.accounts.owner!}}
    expect(getCommentAudienceAccountUids(data, false)).toEqual(['owner'])
    expect(getCommentAudienceAccountUids(data, true)).toEqual(['owner'])
    expect(getRenderedCollaboratorsCount(data, false)).toBe(1)
  })
})
