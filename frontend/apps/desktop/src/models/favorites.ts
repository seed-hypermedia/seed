import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
// @ts-expect-error
import {UnpackedHypermediaId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

export type FavoriteItem = {
  key: 'document'
  id: UnpackedHypermediaId
  url: string
}

export function useFavorites() {
  const favoritesQuery = useQuery({
    queryKey: [queryKeys.FAVORITES],
    queryFn: () => client.favorites.get.query(),
  })
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
  const setFavorite = useMutation({
    mutationFn: (input: {url: string; isFavorite: boolean}) =>
      client.favorites.setFavorite.mutate(input),
    onSuccess: () => {
      invalidateQueries([queryKeys.FAVORITES])
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
