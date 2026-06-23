import type {HMCapability, HMListDocumentCollaboratorsOutput, HMSiteMember} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {dedupeSiteMembersByCanonicalAccount} from '../api-document-collaborators'
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
    grantId: hmId('site'),
    createTime: {seconds: 0, nanos: 0},
  }
}

function member(accountUid: string): HMSiteMember {
  return {
    account: hmId(accountUid),
    role: 'member',
  }
}

describe('dedupeSiteMembersByCanonicalAccount', () => {
  it('keeps the writer row when the same account is also a regular member', () => {
    const result = dedupeSiteMembersByCanonicalAccount({
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
    const result = dedupeSiteMembersByCanonicalAccount({
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
