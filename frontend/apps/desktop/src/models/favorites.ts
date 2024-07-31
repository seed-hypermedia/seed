import {trpc} from '@/trpc'
import {HMAccount, UnpackedHypermediaId, unpackHmId} from '@shm/shared'
import {useMemo} from 'react'
import {useQueryInvalidator} from '../app-context'
import {useAccounts} from './accounts'

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
  const {accounts, favorites, favoriteUrls} = useMemo(() => {
    const favoriteUrls: string[] = []
    const unpackedIds = favoritesQuery.data?.favorites.map((favorite) => {
      favoriteUrls.push(favorite.url)
      return unpackHmId(favorite.url)
    })
    const accounts: string[] = []
    unpackedIds?.forEach((id) => {
      if (id?.type === 'd') {
        accounts.push(id.uid)
      }
    })
    return {
      favorites: unpackedIds,
      favoriteUrls,
      accounts,
    }
  }, [favoritesQuery.data])
  const accountsQuery = useAccounts(accounts)
  const favoriteItems: FavoriteItem[] = []
  favorites?.forEach((id, favoriteIndex) => {
    const url = favoriteUrls[favoriteIndex]
    if (id?.type === 'd' && url) {
      const accountQ = accountsQuery.find(
        (account) => account.data?.id === id.uid,
      )
      const account = accountQ?.data
      if (account) {
        favoriteItems.push({
          key: 'account',
          id,
          url,
          accountId: id.id,
          account,
        })
      }
    }
  })

  return favoriteItems
}

export function useFavorite(url?: string | null) {
  const favorites = useFavorites()
  const invalidate = useQueryInvalidator()
  const setFavorite = trpc.favorites.setFavorite.useMutation({
    onSuccess: () => {
      invalidate(['trpc.favorites.get'])
    },
  })
  if (!url)
    return {isFavorited: false, removeFavorite: () => {}, addFavorite: () => {}}
  const isFavorited = favorites.some((favorite) => favorite.url === url)
  return {
    isFavorited,
    removeFavorite: () => {
      setFavorite.mutate({url, isFavorite: false})
    },
    addFavorite: () => {
      setFavorite.mutate({url, isFavorite: true})
    },
  }
}
