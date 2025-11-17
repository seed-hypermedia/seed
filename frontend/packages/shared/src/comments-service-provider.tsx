import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {HMComment, UnpackedHypermediaId} from './hm-types'
import {
  CommentsService,
  DeleteCommentRequest,
  GetReplyCountRequest,
  ListCommentsByReferenceRequest,
  ListCommentsByReferenceResponse,
  ListCommentsResponse,
  ListDiscussionsRequest,
  ListDiscussionsResponse,
} from './models/comments-service'
import {queryKeys} from './models/query-keys'
import {hmId} from './utils/entity-id-url'

type CommentsProviderValue = {
  onReplyClick: (comment: HMComment) => void
  onReplyCountClick: (comment: HMComment) => void
  service: CommentsService | null
}

const defaultCommentsContext = {
  onReplyClick: (comment: HMComment) => {
    console.log('onReplyClick not implemented', comment)
  },
  onReplyCountClick: (comment: HMComment) => {
    console.log('onReplyCountClick not implemented', comment)
  },
  service: null,
}

const CommentsContext = createContext<CommentsProviderValue>(
  defaultCommentsContext,
)

export function CommentsProvider({
  children,
  onReplyClick = defaultCommentsContext.onReplyClick,
  onReplyCountClick = defaultCommentsContext.onReplyCountClick,
  service = null,
}: PropsWithChildren<CommentsProviderValue>) {
  return (
    <CommentsContext.Provider
      value={useMemo(
        () => ({onReplyClick, onReplyCountClick, service}),
        [onReplyClick, onReplyCountClick, service],
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

export function useCommentsService(params: ListDiscussionsRequest) {
  const context = useCommentsServiceContext()
  return useQuery({
    queryKey: [queryKeys.DOCUMENT_COMMENTS, params.targetId, params.commentId],
    queryFn: async (): Promise<ListCommentsResponse> => {
      if (!context.service) {
        return {comments: [], authors: {}}
      }
      try {
        const res = await context.service.listComments(params)
        return res
      } catch (error) {
        console.error('Error fetching comments:', error)
        throw error
      }
    },
    enabled: !!context.service,
    retry: 1,
  })
}

export function useDiscussionsService(params: ListDiscussionsRequest) {
  const context = useCommentsServiceContext()

  return useQuery({
    queryKey: [
      queryKeys.DOCUMENT_DISCUSSION,
      params.targetId,
      params.commentId,
    ],
    queryFn: async (): Promise<ListDiscussionsResponse> => {
      if (!context.service) {
        return {discussions: [], authors: {}, citingDiscussions: []}
      }

      try {
        const res = await context.service.listDiscussions(params)
        return res
      } catch (error) {
        console.error('Error fetching discussions:', error)
        throw error
      }
    },
    enabled: !!context.service,
    retry: 1,
  })
}

export function useBlockDiscussionsService(
  params: ListCommentsByReferenceRequest,
) {
  const context = useCommentsServiceContext()

  return useQuery({
    queryKey: [queryKeys.BLOCK_DISCUSSIONS, params.targetId],
    queryFn: async (): Promise<ListCommentsByReferenceResponse> => {
      if (!context.service) {
        return {comments: [], authors: {}}
      }
      try {
        const res = await context.service.listCommentsByReference(params)
        return res
      } catch (error) {
        console.error('Error fetching block discussions:', error)
        throw error
      }
    },
    enabled: !!context.service,
    retry: 1,
  })
}

export function useHackyAuthorsSubscriptions(authorIds: string[]) {
  const context = useCommentsServiceContext()!
  context.service!.useHackyAuthorsSubscriptions(authorIds)
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
  const context = useCommentsServiceContext()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: DeleteCommentRequest) => {
      if (!context.service) {
        throw new Error('CommentsService not available')
      }
      await context.service.deleteComment(params)
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

export function useCommentReplyCount({id}: GetReplyCountRequest) {
  const context = useCommentsServiceContext()

  return useQuery({
    queryKey: [id, 'replyCount'],
    queryFn: () => context.service?.getReplyCount({id}),
    enabled: !!context.service,
    retry: 1,
  })
}
