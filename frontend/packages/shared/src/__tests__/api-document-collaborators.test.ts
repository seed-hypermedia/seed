import type {HMCapability, HMListDocumentCollaboratorsOutput, HMSpaceMember} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {dedupeSpaceMembersByCanonicalAccount} from '../api-document-collaborators'
import {hmId} from '../utils/entity-id-url'

function account(rawUid: string, canonicalUid: string = rawUid): HMListDocumentCollaboratorsOutput['accounts'][string] {
  return {
    id: hmId(canonicalUid),
    metadata: {name: canonicalUid},
  }
}

function capability(accountUid: string): HMCapability {
  return {
    id: `cap-${accountUid}`,
    accountUid,
    role: 'writer',
    grantId: hmId('space'),
    createTime: {seconds: 0, nanos: 0},
  }
}

function member(accountUid: string): HMSpaceMember {
  return {
    account: hmId(accountUid),
    role: 'member',
  }
}

describe('dedupeSpaceMembersByCanonicalAccount', () => {
  it('keeps the writer row when the same account is also a regular member', () => {
    const result = dedupeSpaceMembersByCanonicalAccount({
      accounts: {
        writer: account('writer'),
      },
      capabilities: [capability('writer')],
      members: [member('writer')],
    })

    expect(result.grantedMembers).toEqual([{account: hmId('writer'), role: 'writer'}])
    expect(result.members).toEqual([])
  })

  it('collapses delegate accounts to the canonical root account', () => {
    const result = dedupeSpaceMembersByCanonicalAccount({
      accounts: {
        delegate: account('delegate', 'root'),
        root: account('root'),
      },
      capabilities: [capability('delegate')],
      members: [member('root')],
    })

    expect(result.grantedMembers).toEqual([{account: hmId('root'), role: 'writer'}])
    expect(result.members).toEqual([])
  })
})
