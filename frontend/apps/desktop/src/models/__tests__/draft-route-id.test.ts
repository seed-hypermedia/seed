import {describe, expect, it} from 'vitest'
import {hmId} from '@shm/shared'
import {
  draftDocumentRouteId,
  getPublishedResourceIdForDraftRoute,
  isDraftDocumentRoute,
  isLocationOnlyDraftRoute,
} from '../../utils/draft-route'

describe('draftDocumentRouteId', () => {
  it('uses edit path when the draft has an edit target', () => {
    const id = draftDocumentRouteId({
      id: 'draft-1',
      editUid: 'acct',
      editPath: ['published'],
      locationUid: 'acct',
      locationPath: ['parent'],
    })

    expect(id?.uid).toBe('acct')
    expect(id?.path).toEqual(['published'])
  })

  it('uses a private placeholder path when the draft only has a location target', () => {
    const id = draftDocumentRouteId({
      id: 'draft-1',
      locationUid: 'acct',
      locationPath: ['parent'],
    })

    expect(id?.uid).toBe('acct')
    expect(id?.path).toEqual(['parent', '-draft-1'])
  })

  it('does not append the draft placeholder twice when locationPath already includes it', () => {
    const id = draftDocumentRouteId({
      id: 'draft-1',
      locationUid: 'acct',
      locationPath: ['parent', '-draft-1'],
    })

    expect(id?.uid).toBe('acct')
    expect(id?.path).toEqual(['parent', '-draft-1'])
  })

  it('returns undefined when the draft has no route target', () => {
    expect(draftDocumentRouteId({id: 'draft-1'})).toBeUndefined()
  })

  it('matches location-only placeholder routes whether locationPath stores parent or full placeholder path', () => {
    const parentRoute = draftDocumentRouteId({id: 'draft-1', locationUid: 'acct', locationPath: ['parent']})!
    expect(isLocationOnlyDraftRoute(parentRoute, {id: 'draft-1', locationUid: 'acct', locationPath: ['parent']})).toBe(
      true,
    )
    expect(
      isLocationOnlyDraftRoute(parentRoute, {
        id: 'draft-1',
        locationUid: 'acct',
        locationPath: ['parent', '-draft-1'],
      }),
    ).toBe(true)
  })

  it('matches edit-target draft document routes exactly', () => {
    expect(
      isDraftDocumentRoute(hmId('acct', {path: ['parent', '-draft-1']}), {
        id: 'draft-1',
        editUid: 'acct',
        editPath: ['parent', '-draft-1'],
        locationUid: 'acct',
        locationPath: ['parent'],
      }),
    ).toBe(true)

    expect(
      isDraftDocumentRoute(hmId('acct', {path: ['parent', '-other']}), {
        id: 'draft-1',
        editUid: 'acct',
        editPath: ['parent', '-draft-1'],
        locationUid: 'acct',
        locationPath: ['parent'],
      }),
    ).toBe(false)
  })

  it('suppresses published resource fetches for placeholder draft routes', () => {
    const placeholderRoute = hmId('acct', {path: ['parent', '-draft-1']})

    expect(getPublishedResourceIdForDraftRoute(placeholderRoute, false)).toBeNull()
  })

  it('suppresses published resource fetches for location-only draft routes', () => {
    const placeholderRoute = hmId('acct', {path: ['parent', '-draft-1']})

    expect(
      getPublishedResourceIdForDraftRoute(placeholderRoute, {
        id: 'draft-1',
        locationUid: 'acct',
        locationPath: ['parent'],
      }),
    ).toBeNull()
  })
})
