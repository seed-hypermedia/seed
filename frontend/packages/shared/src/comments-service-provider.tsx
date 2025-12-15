import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {
  HMComment,
  HMGetCommentReplyCountRequest,
  HMListCommentsByReferenceInput,
  HMListCommentsByReferenceRequest,
  HMListCommentsInput,
  HMListCommentsOutput,
  HMListCommentsRequest,
  HMListDiscussionsInput,
  HMListDiscussionsOutput,
  HMListDiscussionsRequest,
  UnpackedHypermediaId,
} from './hm-types'
import {queryKeys} from './models/query-keys'
import {useUniversalClient} from './routing'
import {DeleteCommentInput} from './universal-client'
import {hmId} from './utils/entity-id-url'

type CommentsProviderValue = {
  onReplyClick: (comment: HMComment) => void
  onReplyCountClick: (comment: HMComment) => void
  /**
   * Desktop-only hook to subscribe to author resources for syncing.
   * No-op on web. This is a temporary workaround while syncing is improved.
   */
  useHackyAuthorsSubscriptions?: (authorIds: string[]) => void
}

const defaultCommentsContext: CommentsProviderValue = {
  onReplyClick: (comment: HMComment) => {
    console.log('onReplyClick not implemented', comment)
  },
  onReplyCountClick: (comment: HMComment) => {
    console.log('onReplyCountClick not implemented', comment)
  },
  useHackyAuthorsSubscriptions: undefined,
}

const CommentsContext = createContext<CommentsProviderValue>(
  defaultCommentsContext,
)

export function CommentsProvider({
  children,
  onReplyClick = defaultCommentsContext.onReplyClick,
  onReplyCountClick = defaultCommentsContext.onReplyCountClick,
  useHackyAuthorsSubscriptions,
}: PropsWithChildren<CommentsProviderValue>) {
  return (
    <CommentsContext.Provider
      value={useMemo(
        () => ({onReplyClick, onReplyCountClick, useHackyAuthorsSubscriptions}),
        [onReplyClick, onReplyCountClick, useHackyAuthorsSubscriptions],
      )}
    >
      {children}
    </CommentsContext.Provider>
  )
}

export function useCommentsServiceContext() {
  const context = useContext(CommentsContext)
  if (!context) {
    throw new Error('CommentsContext not found')
  }
  return context
}

export function useCommentsService(params: HMListCommentsInput) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.DOCUMENT_COMMENTS, params.targetId],
    queryFn: async (): Promise<HMListCommentsOutput> => {
      try {
        return await client.request<HMListCommentsRequest>(
          'ListComments',
          params,
        )
      } catch (error) {
        console.error('Error fetching comments:', error)
        throw error
      }
    },
    retry: 1,
  })
}

export function useDiscussionsService(params: HMListDiscussionsInput) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [
      queryKeys.DOCUMENT_DISCUSSION,
      params.targetId,
      params.commentId,
    ],
    queryFn: async (): Promise<HMListDiscussionsOutput> => {
      try {
        return await client.request<HMListDiscussionsRequest>(
          'ListDiscussions',
          params,
        )
      } catch (error) {
        console.error('Error fetching discussions:', error)
        throw error
      }
    },
    retry: 1,
  })
}

export function useBlockDiscussionsService(
  params: HMListCommentsByReferenceInput,
) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [queryKeys.BLOCK_DISCUSSIONS, params.targetId],
    queryFn: async (): Promise<HMListCommentsOutput> => {
      try {
        return await client.request<HMListCommentsByReferenceRequest>(
          'ListCommentsByReference',
          params,
        )
      } catch (error) {
        console.error('Error fetching block discussions:', error)
        throw error
      }
    },
    retry: 1,
  })
}

export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  const context = useCommentsServiceContext()
  context.useHackyAuthorsSubscriptions?.(authorIds)
}

export function isRouteEqualToCommentTarget({
  id,
  comment,
}: {
  id: UnpackedHypermediaId
  comment: HMComment
}): UnpackedHypermediaId | null {
  if (!id) return null

  const targetRoute = hmId(`${comment.targetAccount}${comment.targetPath}`, {
    version: comment.targetVersion,
  })

  console.log({id, targetRoute})
  console.log('targetRoute.uid == id.uid', targetRoute.uid == id.uid)
  console.log('path', targetRoute.path?.join('/') == id.path?.join('/'))

  if (
    targetRoute.uid == id.uid &&
    targetRoute.path?.join('/') == id.path?.join('/')
  ) {
    return null
  }

  return targetRoute
}

export function useDeleteComment() {
  const client = useUniversalClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: DeleteCommentInput) => {
      if (!client.deleteComment) {
        throw new Error('deleteComment not available on this platform')
      }
      await client.deleteComment(params)
    },
    onSuccess: () => {
      // Invalidate all comment-related queries to refresh the UI
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_COMMENTS],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLOCK_DISCUSSIONS],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.ACTIVITY_FEED],
      })
    },
  })
}

export function useCommentReplyCount({id}: {id: string}) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [id, 'replyCount'],
    queryFn: () =>
      client.request<HMGetCommentReplyCountRequest>('GetCommentReplyCount', {
        id,
      }),
    retry: 1,
  })
}
