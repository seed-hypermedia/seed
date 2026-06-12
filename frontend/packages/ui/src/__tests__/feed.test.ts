import {describe, expect, it} from 'vitest'
import {
  canShowRestoreVersionButton,
  getDraftVersionInsertIndex,
  getLatestDocUpdateVersion,
  isSelectedDocUpdateVersion,
  shouldShowDraftVersionEntry,
} from '../feed'

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

describe('version selection helpers', () => {
  it('uses the newest doc-update event as the latest version for a document feed', () => {
    expect(getLatestDocUpdateVersion([docUpdate('latest-version'), docUpdate('old-version')])).toBe('latest-version')
  })

  it('selects the explicit route version', () => {
    expect(isSelectedDocUpdateVersion('version-1', 'version-1', false, 'version-2')).toBe(true)
    expect(isSelectedDocUpdateVersion('version-2', 'version-1', false, 'version-2')).toBe(false)
  })

  it('selects the latest version when the route has no explicit version', () => {
    expect(isSelectedDocUpdateVersion('latest-version', null, true, 'latest-version')).toBe(true)
    expect(isSelectedDocUpdateVersion('old-version', null, true, 'latest-version')).toBe(false)
  })
})

describe('restore version action helpers', () => {
  it('allows restore when the provider exposes a selected account and restore action', () => {
    expect(
      canShowRestoreVersionButton({
        isSingleResource: true,
        selectedAccountUid: 'writer',
        latestVersion: 'latest-version',
        eventVersion: 'old-version',
        hasRestoreAction: true,
      }),
    ).toBe(true)
  })

  it('does not allow restore without a provider-selected account', () => {
    expect(
      canShowRestoreVersionButton({
        isSingleResource: true,
        selectedAccountUid: undefined,
        latestVersion: 'latest-version',
        eventVersion: 'old-version',
        hasRestoreAction: true,
      }),
    ).toBe(false)
  })
})
