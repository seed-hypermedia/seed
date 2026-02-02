import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const BOOKMARKS_STORAGE_KEY = 'Bookmarks-v001'
const LEGACY_FAVORITES_KEY = 'Favorites-v001'

type BookmarksState = {
  bookmarks: {
    url: string
  }[]
}

// Migration: if Favorites-v001 exists, migrate to Bookmarks-v001
function migrateFromFavorites(): void {
  const legacyFavorites = appStore.get(LEGACY_FAVORITES_KEY) as
    | {favorites: {url: string}[]}
    | undefined
  if (legacyFavorites) {
    const migratedState: BookmarksState = {
      bookmarks: legacyFavorites.favorites || [],
    }
    appStore.set(BOOKMARKS_STORAGE_KEY, migratedState)
    appStore.delete(LEGACY_FAVORITES_KEY)
  }
}

function loadBookmarks(): BookmarksState {
  migrateFromFavorites()
  return (
    (appStore.get(BOOKMARKS_STORAGE_KEY) as BookmarksState) || {
      bookmarks: [],
    }
  )
}

let state: BookmarksState = loadBookmarks()

async function writeBookmarks(newState: BookmarksState) {
  state = newState
  appStore.set(BOOKMARKS_STORAGE_KEY, newState)
  return undefined
}

export const bookmarksApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),
  setBookmark: t.procedure
    .input(z.object({url: z.string(), isBookmark: z.boolean()}))
    .mutation(async ({input}) => {
      const newBookmarks = state.bookmarks.filter(
        (bookmark) => bookmark.url !== input.url,
      )
      if (input.isBookmark) {
        newBookmarks.push({url: input.url})
      }
      await writeBookmarks({
        ...state,
        bookmarks: newBookmarks,
      })
    }),
  addBookmark: t.procedure.input(z.string()).mutation(async ({input}) => {
    await writeBookmarks({
      ...state,
      bookmarks: [
        ...state.bookmarks.filter((bookmark) => bookmark.url !== input),
        {
          url: input,
        },
      ],
    })
    return undefined
  }),
  removeBookmark: t.procedure.input(z.string()).mutation(async ({input}) => {
    await writeBookmarks({
      ...state,
      bookmarks: state.bookmarks.filter((bookmark) => bookmark.url !== input),
    })
    return undefined
  }),
})
