import {describe, expect, it} from 'vitest'
import {draftDocumentRouteId, isLocationOnlyDraftRoute} from '../../utils/draft-route'

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
})
