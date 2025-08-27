import {useQuery} from '@tanstack/react-query'
import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {HMComment} from './hm-types'
import {
  CommentsService,
  ListCommentsByReferenceRequest,
  ListCommentsByReferenceResponse,
  ListCommentsResponse,
  ListDiscussionsRequest,
  ListDiscussionsResponse,
} from './models/comments-service'
import {queryKeys} from './models/query-keys'

type CommentsProviderValue = {
  onReplyClick: (replyComment: HMComment) => void
  onReplyCountClick: (replyComment: HMComment) => void
  service: CommentsService | null
}

const defaultCommentsContext = {
  onReplyClick: (replyComment: HMComment) => {
    console.log('onReplyClick not implemented', replyComment)
  },
  onReplyCountClick: (replyComment: HMComment) => {
    console.log('onReplyCountClick not implemented', replyComment)
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
      const res = await context.service.listComments(params)
      return res
    },
    enabled: !!context.service,
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
        return {discussions: [], authors: {}}
      }

      const res = await context.service.listDiscussions(params)

      return res
    },
    enabled: !!context.service,
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
      const res = await context.service.listCommentsByReference(params)
      // console.log(
      //   `\n\n======================== ~ useBlockDiscussionsService ~ res:`,
      //   res,
      // )
      return res
    },
    enabled: !!context.service,
  })
}
