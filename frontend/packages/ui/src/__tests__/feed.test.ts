import {describe, expect, it} from 'vitest'
import {
  canShowRestoreVersionButton,
  getDraftVersionInsertIndex,
  getLatestDocUpdateVersion,
  isSelectedDocUpdateVersion,
  RESTORE_VERSION_ACTION_BUTTON_CLASS,
  RESTORE_VERSION_ACTION_ICON_CLASS,
  RESTORE_VERSION_DIALOG,
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
  it('uses the requested confirmation dialog copy and button variants', () => {
    expect(RESTORE_VERSION_DIALOG).toEqual({
      title: 'Restore this version?',
      description:
        'Your current draft will be discarded. This version will become the new latest version — you can always restore back later if needed.',
      cancelVariant: 'ghost',
      restoreVariant: 'danger',
    })
  })

  it('allows restore when the provider exposes a selected account that can write and a restore action', () => {
    expect(
      canShowRestoreVersionButton({
        isSingleResource: true,
        selectedAccountUid: 'writer',
        selectedAccountCanWriteDocument: true,
        latestVersion: 'latest-version',
        eventVersion: 'old-version',
        hasRestoreAction: true,
      }),
    ).toBe(true)
  })

  it('does not allow restore when the selected account cannot write the document', () => {
    expect(
      canShowRestoreVersionButton({
        isSingleResource: true,
        selectedAccountUid: 'reader',
        selectedAccountCanWriteDocument: false,
        latestVersion: 'latest-version',
        eventVersion: 'old-version',
        hasRestoreAction: true,
      }),
    ).toBe(false)
  })

  it('keeps version action buttons the same size while making their icons readable', () => {
    expect(RESTORE_VERSION_ACTION_BUTTON_CLASS).toContain('text-foreground')
    expect(RESTORE_VERSION_ACTION_BUTTON_CLASS).not.toContain('text-muted-foreground')
    expect(RESTORE_VERSION_ACTION_BUTTON_CLASS).not.toContain('h-')
    expect(RESTORE_VERSION_ACTION_BUTTON_CLASS).not.toContain('min-w-')
    expect(RESTORE_VERSION_ACTION_ICON_CLASS).toBe('size-4')
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
