import z from 'zod'
import {appStore} from './app-store'
import {t} from './app-trpc'

const FAVORITES_STORAGE_KEY = 'Favorites-v001'

type FavoritesState = {
  favorites: {
    url: string
  }[]
}

let state: FavoritesState = (appStore.get(
  FAVORITES_STORAGE_KEY,
) as FavoritesState) || {favorites: []}

async function writeFavorites(newState: FavoritesState) {
  state = newState
  appStore.set(FAVORITES_STORAGE_KEY, newState)
  return undefined
}

export const favoritesApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),
  setFavorite: t.procedure
    .input(z.object({url: z.string(), isFavorite: z.boolean()}))
    .mutation(async ({input}) => {
      const newFavorites = state.favorites.filter(
        (favorite) => favorite.url !== input.url,
      )
      if (input.isFavorite) {
        newFavorites.push({url: input.url})
      }
      await writeFavorites({
        ...state,
        favorites: newFavorites,
      })
    }),
  addFavorite: t.procedure.input(z.string()).mutation(async ({input}) => {
    await writeFavorites({
      ...state,
      favorites: [
        ...state.favorites.filter((favorite) => favorite.url !== input),
        {
          url: input,
        },
      ],
    })
    return undefined
  }),
  removeFavorite: t.procedure.input(z.string()).mutation(async ({input}) => {
    await writeFavorites({
      ...state,
      favorites: state.favorites.filter((favorite) => favorite.url !== input),
    })
    return undefined
  }),
})
