import {describe, expect, it, vi} from 'vitest'
import {migrateFromFavorites} from '../migrate-favorites'

function createMockStore(initial: Record<string, any> = {}) {
  const data = {...initial}
  return {
    get: vi.fn((key: string) => data[key]),
    set: vi.fn((key: string, value: any) => {
      data[key] = value
    }),
    delete: vi.fn((key: string) => {
      delete data[key]
    }),
    _data: data,
  }
}

describe('migrateFromFavorites', () => {
  it('migrates favorites to bookmarks', () => {
    const store = createMockStore({
      'Favorites-v001': {
        favorites: [{url: 'hm://doc1'}, {url: 'hm://doc2'}],
      },
    })

    migrateFromFavorites(store)

    expect(store.set).toHaveBeenCalledWith('Bookmarks-v001', {
      bookmarks: [{url: 'hm://doc1'}, {url: 'hm://doc2'}],
    })
    expect(store.delete).toHaveBeenCalledWith('Favorites-v001')
    expect(store._data['Bookmarks-v001']).toEqual({
      bookmarks: [{url: 'hm://doc1'}, {url: 'hm://doc2'}],
    })
    expect(store._data['Favorites-v001']).toBeUndefined()
  })

  it('does nothing when no legacy favorites exist', () => {
    const store = createMockStore({})

    migrateFromFavorites(store)

    expect(store.set).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('handles empty favorites array', () => {
    const store = createMockStore({
      'Favorites-v001': {favorites: []},
    })

    migrateFromFavorites(store)

    expect(store.set).toHaveBeenCalledWith('Bookmarks-v001', {
      bookmarks: [],
    })
    expect(store.delete).toHaveBeenCalledWith('Favorites-v001')
  })

  it('handles missing favorites property (null/undefined)', () => {
    const store = createMockStore({
      'Favorites-v001': {},
    })

    migrateFromFavorites(store)

    expect(store.set).toHaveBeenCalledWith('Bookmarks-v001', {
      bookmarks: [],
    })
    expect(store.delete).toHaveBeenCalledWith('Favorites-v001')
  })

  it('filters out malformed favorite entries', () => {
    const store = createMockStore({
      'Favorites-v001': {
        favorites: [
          {url: 'hm://valid'},
          null,
          {url: 123},
          undefined,
          {noUrl: true},
          {url: 'hm://also-valid'},
        ],
      },
    })

    migrateFromFavorites(store)

    expect(store._data['Bookmarks-v001']).toEqual({
      bookmarks: [{url: 'hm://valid'}, {url: 'hm://also-valid'}],
    })
    expect(store._data['Favorites-v001']).toBeUndefined()
  })

  it('preserves legacy data if store.set throws', () => {
    const store = createMockStore({
      'Favorites-v001': {favorites: [{url: 'hm://doc1'}]},
    })
    store.set.mockImplementation(() => {
      throw new Error('disk full')
    })

    migrateFromFavorites(store)

    // Legacy data should still be there since set failed
    expect(store._data['Favorites-v001']).toEqual({
      favorites: [{url: 'hm://doc1'}],
    })
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('preserves legacy data if verification fails', () => {
    const store = createMockStore({
      'Favorites-v001': {favorites: [{url: 'hm://doc1'}]},
    })
    // set succeeds but the written value can't be read back
    let callCount = 0
    store.get.mockImplementation((key: string) => {
      if (key === 'Favorites-v001' && callCount === 0) {
        callCount++
        return {favorites: [{url: 'hm://doc1'}]}
      }
      if (key === 'Bookmarks-v001') {
        return undefined // verification read fails
      }
      return undefined
    })

    migrateFromFavorites(store)

    expect(store.delete).not.toHaveBeenCalled()
  })

  it('does not re-migrate if bookmarks already exist and favorites are gone', () => {
    const store = createMockStore({
      'Bookmarks-v001': {bookmarks: [{url: 'hm://existing'}]},
    })

    migrateFromFavorites(store)

    expect(store.set).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('handles favorites being a non-array value', () => {
    const store = createMockStore({
      'Favorites-v001': {favorites: 'not-an-array'},
    })

    migrateFromFavorites(store)

    expect(store._data['Bookmarks-v001']).toEqual({
      bookmarks: [],
    })
  })

  it('single favorite migrates correctly', () => {
    const store = createMockStore({
      'Favorites-v001': {favorites: [{url: 'hm://only-one'}]},
    })

    migrateFromFavorites(store)

    expect(store._data['Bookmarks-v001']).toEqual({
      bookmarks: [{url: 'hm://only-one'}],
    })
    expect(store._data['Favorites-v001']).toBeUndefined()
  })
})
