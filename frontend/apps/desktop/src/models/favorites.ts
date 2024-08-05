import {trpc} from '@/trpc'
import {HMAccount, UnpackedHypermediaId, unpackHmId} from '@shm/shared'
import {useMemo} from 'react'
import {useQueryInvalidator} from '../app-context'

export type FavoriteItem =
  | {
      key: 'document'
      id: UnpackedHypermediaId
      url: string
    }
  | {
      key: 'account'
      id: UnpackedHypermediaId
      url: string
      accountId: string
      account: HMAccount
    }

export function useFavorites() {
  const favoritesQuery = trpc.favorites.get.useQuery()
  const {favorites} = useMemo(() => {
    const unpackedIds = favoritesQuery.data?.favorites.map((favorite) => {
      return unpackHmId(favorite.url)
    })
    return {
      favorites: unpackedIds,
    }
  }, [favoritesQuery.data])
  return favorites
}

export function useFavorite(id?: UnpackedHypermediaId) {
  const favorites = useFavorites()
  const invalidate = useQueryInvalidator()
  const setFavorite = trpc.favorites.setFavorite.useMutation({
    onSuccess: () => {
      invalidate(['trpc.favorites.get'])
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
