import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {findDraftForPath, type HMListedDraftWithLocation} from '../draft-breadcrumb-context'
import {hmId} from '../utils/entity-id-url'

function makeDraft(overrides: Partial<HMListedDraftWithLocation>): HMListedDraftWithLocation {
  return {
    id: overrides.id ?? 'draft-1',
    metadata: (overrides.metadata as HMMetadata) ?? ({name: 'unnamed'} as HMMetadata),
    visibility: overrides.visibility ?? 'PUBLIC',
    deps: overrides.deps ?? [],
    lastUpdateTime: overrides.lastUpdateTime ?? 0,
    ...overrides,
  }
}

describe('findDraftForPath', () => {
  it('returns null when no drafts are loaded', () => {
    expect(findDraftForPath(undefined, 'acc', ['x'])).toBeNull()
    expect(findDraftForPath([], 'acc', ['x'])).toBeNull()
  })

  it('matches a draft whose editId points at the exact published path', () => {
    const draft = makeDraft({
      editUid: 'acc',
      editPath: ['guides', 'install'],
      editId: hmId('acc', {path: ['guides', 'install']}),
    })

    const match = findDraftForPath([draft], 'acc', ['guides', 'install'])

    expect(match).toBe(draft)
  })

  it('does not match when uid differs', () => {
    const draft = makeDraft({
      editUid: 'acc',
      editPath: ['guides'],
      editId: hmId('acc', {path: ['guides']}),
    })

    expect(findDraftForPath([draft], 'other', ['guides'])).toBeNull()
  })

  it('does not match when path differs', () => {
    const draft = makeDraft({
      editUid: 'acc',
      editPath: ['guides'],
      editId: hmId('acc', {path: ['guides']}),
    })

    expect(findDraftForPath([draft], 'acc', ['guides', 'install'])).toBeNull()
  })

  it('falls back to locationId for new-child drafts with -draftId placeholder segment', () => {
    const draft = makeDraft({
      id: 'draft-xyz',
      locationUid: 'acc',
      locationPath: ['parent'],
      editUid: 'acc',
      editPath: ['parent', '-draft-xyz'],
      locationId: hmId('acc', {path: ['parent']}),
      editId: hmId('acc', {path: ['parent', '-draft-xyz']}),
    })

    const match = findDraftForPath([draft], 'acc', ['parent', '-draft-xyz'])

    expect(match).toBe(draft)
  })

  it('does not use locationId fallback when last segment is not a placeholder', () => {
    const draft = makeDraft({
      locationUid: 'acc',
      locationPath: ['parent'],
      locationId: hmId('acc', {path: ['parent']}),
    })

    expect(findDraftForPath([draft], 'acc', ['parent', 'real-doc'])).toBeNull()
  })

  it('prefers editId over locationId when both could match', () => {
    const wrongLocationDraft = makeDraft({
      id: 'loc-draft',
      locationUid: 'acc',
      locationPath: ['parent'],
      locationId: hmId('acc', {path: ['parent']}),
    })
    const editDraft = makeDraft({
      id: 'edit-draft',
      editUid: 'acc',
      editPath: ['parent', '-x'],
      editId: hmId('acc', {path: ['parent', '-x']}),
    })

    const match = findDraftForPath([wrongLocationDraft, editDraft], 'acc', ['parent', '-x'])

    expect(match).toBe(editDraft)
  })
})
