import {describe, expect, it} from 'vitest'
import {getDraftVersionInsertIndex, shouldShowDraftVersionEntry} from '../feed'

const draft = {
  docId: {
    id: 'hm://doc',
    uid: 'doc',
    path: [],
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  },
  draftId: 'draft-1',
  deps: ['base-version'],
}

function docUpdate(version: string) {
  return {
    type: 'doc-update',
    id: `event-${version}`,
    time: Date.now(),
    document: {version},
  } as any
}

describe('draft versions feed helpers', () => {
  it('shows the synthetic draft row only in versions history', () => {
    expect(shouldShowDraftVersionEntry(['Ref'], draft)).toBe(true)
    expect(shouldShowDraftVersionEntry([], draft)).toBe(false)
    expect(shouldShowDraftVersionEntry(['Comment'], draft)).toBe(false)
    expect(shouldShowDraftVersionEntry(['Ref'], undefined)).toBe(false)
  })

  it('places newer published versions above the draft and the base version below it', () => {
    const events = [docUpdate('newer-version'), docUpdate('base-version'), docUpdate('older-version')]
    expect(getDraftVersionInsertIndex(events, draft)).toBe(1)
  })

  it('places drafts without a visible base version at the top', () => {
    expect(getDraftVersionInsertIndex([docUpdate('latest-version')], {...draft, deps: ['missing-base']})).toBe(0)
    expect(getDraftVersionInsertIndex([docUpdate('latest-version')], {...draft, deps: []})).toBe(0)
  })
})
