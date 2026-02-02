import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
// @ts-expect-error
import {UnpackedHypermediaId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

export type BookmarkItem = {
  key: 'document'
  id: UnpackedHypermediaId
  url: string
}

export function useBookmarks() {
  const bookmarksQuery = useQuery({
    queryKey: [queryKeys.BOOKMARKS],
    queryFn: () => client.bookmarks.get.query(),
  })
  const {bookmarks} = useMemo(() => {
    const unpackedIds = bookmarksQuery.data?.bookmarks?.map((bookmark) => {
      return unpackHmId(bookmark.url)
    })
    return {
      bookmarks: unpackedIds || [],
    }
  }, [bookmarksQuery.data])
  return bookmarks
}

export function useBookmark(id?: UnpackedHypermediaId) {
  const bookmarks = useBookmarks()
  const setBookmark = useMutation({
    mutationFn: (input: {url: string; isBookmark: boolean}) =>
      client.bookmarks.setBookmark.mutate(input),
    onSuccess: () => {
      invalidateQueries([queryKeys.BOOKMARKS])
    },
  })
  if (!id)
    return {isBookmarked: false, removeBookmark: () => {}, addBookmark: () => {}}
  const isBookmarked = bookmarks?.some(
    (bookmark) => bookmark && bookmark.id === id.id,
  )
  return {
    isBookmarked,
    removeBookmark: () => {
      setBookmark.mutate({url: id.id, isBookmark: false})
    },
    addBookmark: () => {
      setBookmark.mutate({url: id.id, isBookmark: true})
    },
  }
}
