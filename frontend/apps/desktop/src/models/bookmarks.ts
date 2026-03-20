import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
// @ts-expect-error
import {UnpackedHypermediaId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {extractViewTermFromUrl, ViewTerm} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

export type BookmarkItem = {
  key: 'document'
  id: UnpackedHypermediaId
  url: string
  viewTerm: ViewTerm | null
}

export function useBookmarks(): BookmarkItem[] {
  const bookmarksQuery = useQuery({
    queryKey: [queryKeys.BOOKMARKS],
    queryFn: () => client.bookmarks.get.query(),
  })
  return useMemo(() => {
    if (!bookmarksQuery.data?.bookmarks) return []
    return bookmarksQuery.data.bookmarks
      .map((bookmark) => {
        const {url: cleanUrl, viewTerm} = extractViewTermFromUrl(bookmark.url)
        const id = unpackHmId(cleanUrl)
        if (!id) return null
        return {key: 'document' as const, id, url: bookmark.url, viewTerm}
      })
      .filter((b): b is BookmarkItem => b !== null)
  }, [bookmarksQuery.data])
}

/** Check bookmark state for a specific bookmark URL (including view term). */
export function useBookmark(bookmarkUrl: string | null) {
  const bookmarks = useBookmarks()
  const setBookmark = useMutation({
    mutationFn: (input: {url: string; isBookmark: boolean}) => client.bookmarks.setBookmark.mutate(input),
    onSuccess: () => {
      invalidateQueries([queryKeys.BOOKMARKS])
    },
  })
  if (!bookmarkUrl)
    return {
      isBookmarked: false,
      removeBookmark: () => {},
      addBookmark: () => {},
    }
  const isBookmarked = bookmarks.some((bookmark) => bookmark.url === bookmarkUrl)
  return {
    isBookmarked,
    removeBookmark: () => {
      setBookmark.mutate({url: bookmarkUrl, isBookmark: false})
    },
    addBookmark: () => {
      setBookmark.mutate({url: bookmarkUrl, isBookmark: true})
    },
  }
}
