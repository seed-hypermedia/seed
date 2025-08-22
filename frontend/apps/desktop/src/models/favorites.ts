import {trpc} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
// @ts-expect-error
import {UnpackedHypermediaId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMemo} from 'react'

export type FavoriteItem = {
  key: 'document'
  id: UnpackedHypermediaId
  url: string
}

export function useFavorites() {
  const favoritesQuery = trpc.favorites.get.useQuery()
  const {favorites} = useMemo(() => {
    const unpackedIds = favoritesQuery.data?.favorites?.map((favorite) => {
      return unpackHmId(favorite.url)
    })
    return {
      favorites: unpackedIds || [],
    }
  }, [favoritesQuery.data])
  return favorites
}

export function useFavorite(id?: UnpackedHypermediaId) {
  const favorites = useFavorites()
  const setFavorite = trpc.favorites.setFavorite.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.favorites.get'])
    },
  })
  if (!id)
    return {isFavorited: false, removeFavorite: () => {}, addFavorite: () => {}}
  const isFavorited = favorites?.some(
    (favorite) => favorite && favorite.id === id.id,
  )
  return {
    isFavorited,
    removeFavorite: () => {
      setFavorite.mutate({url: id.id, isFavorite: false})
    },
    addFavorite: () => {
      setFavorite.mutate({url: id.id, isFavorite: true})
    },
  }
}
