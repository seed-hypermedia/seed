const BOOKMARKS_STORAGE_KEY = 'Bookmarks-v001'
const LEGACY_FAVORITES_KEY = 'Favorites-v001'

export type BookmarksState = {
  bookmarks: {
    url: string
  }[]
}

export type StoreInterface = {
  get: (key: string) => any
  set: (key: string, value: any) => void
  delete: (key: string) => void
}

// Migration: if Favorites-v001 exists, migrate to Bookmarks-v001
// Safety: writes new data first, verifies it, then deletes old data.
// If anything fails, old data is preserved and migration retries on next launch.
export function migrateFromFavorites(store: StoreInterface): void {
  try {
    const legacyFavorites = store.get(LEGACY_FAVORITES_KEY) as
      | {favorites: {url: string}[]}
      | undefined
    if (!legacyFavorites) return

    const migratedState: BookmarksState = {
      bookmarks: Array.isArray(legacyFavorites.favorites)
        ? legacyFavorites.favorites.filter(
            (f) => f && typeof f.url === 'string',
          )
        : [],
    }

    store.set(BOOKMARKS_STORAGE_KEY, migratedState)

    // Verify write succeeded before deleting old data
    const written = store.get(BOOKMARKS_STORAGE_KEY) as
      | BookmarksState
      | undefined
    if (written && Array.isArray(written.bookmarks)) {
      store.delete(LEGACY_FAVORITES_KEY)
    } else {
      console.error(
        'Bookmarks migration: verification failed, keeping legacy data for retry',
      )
    }
  } catch (err) {
    console.error(
      'Bookmarks migration failed, legacy favorites preserved for next retry:',
      err,
    )
  }
}
