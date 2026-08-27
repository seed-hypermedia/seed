import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
// @ts-expect-error
import {UnpackedHypermediaId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {extractViewTermFromUrl, hmId, ViewTerm} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

type ResourceBookmarkItem = {
  key: 'document' | 'profile'
  id: UnpackedHypermediaId
  url: string
  viewTerm: ViewTerm | null
}

export type CommentBookmarkItem = {
  key: 'comment'
  id: UnpackedHypermediaId
  url: string
  viewTerm: null
  title: string
  commentId: string
  targetId: UnpackedHypermediaId
  authorAccountId: string
}

export type BookmarkItem = ResourceBookmarkItem | CommentBookmarkItem

type StoredBookmark = {
  url: string
  title?: string
  commentId?: string
  targetUrl?: string
  authorAccountId?: string
}

function isProfileViewTerm(viewTerm: ViewTerm | null) {
  return viewTerm === ':profile' || viewTerm === ':membership' || viewTerm === ':followers' || viewTerm === ':following'
}

export function useBookmarks(): BookmarkItem[] {
  const bookmarksQuery = useQuery({
    queryKey: [queryKeys.BOOKMARKS],
    queryFn: () => client.bookmarks.get.query(),
  })
  return useMemo(() => {
    if (!bookmarksQuery.data?.bookmarks) return []
    return bookmarkItemsFromStored(bookmarksQuery.data.bookmarks)
  }, [bookmarksQuery.data])
}

/** Parse persisted bookmark records while keeping legacy URL-only records compatible. */
export function bookmarkItemsFromStored(bookmarks: StoredBookmark[]): BookmarkItem[] {
  return bookmarks
    .map((bookmark): BookmarkItem | null => {
      if (bookmark.title && bookmark.commentId && bookmark.targetUrl && bookmark.authorAccountId) {
        const id = unpackHmId(bookmark.url)
        const targetId = unpackHmId(bookmark.targetUrl)
        if (!id || !targetId) return null
        return {
          key: 'comment',
          id,
          url: bookmark.url,
          viewTerm: null,
          title: bookmark.title,
          commentId: bookmark.commentId,
          targetId,
          authorAccountId: bookmark.authorAccountId,
        }
      }

      const {url: cleanUrl, viewTerm, accountUid} = extractViewTermFromUrl(bookmark.url)
      const id = unpackHmId(cleanUrl)
      if (!id) return null
      const key = isProfileViewTerm(viewTerm) ? 'profile' : 'document'
      return {key, id: accountUid ? hmId(accountUid) : id, url: bookmark.url, viewTerm}
    })
    .filter((bookmark): bookmark is BookmarkItem => bookmark !== null)
}

/** Remove a bookmark URL from the stored bookmarks list. */
export function useRemoveBookmark() {
  return useMutation({
    mutationFn: (url: string) => client.bookmarks.removeBookmark.mutate(url),
    onSuccess: () => {
      invalidateQueries([queryKeys.BOOKMARKS])
    },
  })
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
