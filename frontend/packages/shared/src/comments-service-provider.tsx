import {
  deleteComment as createDeleteCommentBlob,
  updateComment as createUpdateCommentBlob,
} from '@seed-hypermedia/client'
import {useMutation, useQuery} from '@tanstack/react-query'
import {createContext, PropsWithChildren, ReactNode, useContext, useMemo} from 'react'
import {
  HMBlockNode,
  HMComment,
  HMListCommentsByReferenceInput,
  HMListCommentsInput,
  HMListCommentsOutput,
  HMListCommentVersionsOutput,
  HMListDiscussionsInput,
  HMListDiscussionsOutput,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {invalidateQueries} from './models/query-client'
import {queryKeys} from './models/query-keys'
import {useUniversalClient} from './routing'
import {hmId} from './utils/entity-id-url'

/** Props passed to the inline comment editor renderer. */
export type InlineEditCommentProps = {
  comment: HMComment
  onSave: (content: HMBlockNode[]) => void
  onCancel: () => void
  isSaving: boolean
}

type CommentsProviderValue = {
  onReplyClick?: (comment: HMComment) => void
  onReplyCountClick?: (comment: HMComment) => void
  /** Render an inline editor for editing an existing comment. */
  renderInlineEditor?: (props: InlineEditCommentProps) => ReactNode
  /**
   * Desktop-only hook to subscribe to author resources for syncing.
   * No-op on web. This is a temporary workaround while syncing is improved.
   */
  useHackyAuthorsSubscriptions?: (authorIds: string[]) => void
  /**
   * When true, deleted comment content is shown with a "deleted" banner
   * using the version history (pre-deletion versions).
   * Enabled on desktop where the local node retains all blobs.
   * Disabled on web to respect the author's intent to delete.
   */
  showDeletedContent?: boolean
}

const defaultCommentsContext: CommentsProviderValue = {
  onReplyClick: (comment: HMComment) => {
    console.log('onReplyClick not implemented', comment)
  },
  onReplyCountClick: (comment: HMComment) => {
    console.log('onReplyCountClick not implemented', comment)
  },
  renderInlineEditor: undefined,
  useHackyAuthorsSubscriptions: undefined,
  showDeletedContent: false,
}

const CommentsContext = createContext<CommentsProviderValue>(defaultCommentsContext)

export function CommentsProvider({
  children,
  onReplyClick = defaultCommentsContext.onReplyClick,
  onReplyCountClick = defaultCommentsContext.onReplyCountClick,
  renderInlineEditor,
  useHackyAuthorsSubscriptions,
  showDeletedContent = false,
}: PropsWithChildren<CommentsProviderValue>) {
  return (
    <CommentsContext.Provider
      value={useMemo(
        () => ({onReplyClick, onReplyCountClick, renderInlineEditor, useHackyAuthorsSubscriptions, showDeletedContent}),
        [onReplyClick, onReplyCountClick, renderInlineEditor, useHackyAuthorsSubscriptions, showDeletedContent],
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
        return await client.request('ListComments', params)
      } catch (error) {
        console.error('Error fetching comments:', error)
        throw error
      }
    },
    retry: 1,
    staleTime: 30_000,
  })
}

export function useDiscussionsService(params: HMListDiscussionsInput) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [queryKeys.DOCUMENT_DISCUSSION, params.targetId, params.commentId],
    queryFn: async (): Promise<HMListDiscussionsOutput> => {
      try {
        return await client.request('ListDiscussions', params)
      } catch (error) {
        console.error('Error fetching discussions:', error)
        throw error
      }
    },
    retry: 1,
    staleTime: 30_000,
  })
}

export function useBlockDiscussionsService(params: HMListCommentsByReferenceInput) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [queryKeys.BLOCK_DISCUSSIONS, params.targetId],
    queryFn: async (): Promise<HMListCommentsOutput> => {
      try {
        return await client.request('ListCommentsByReference', params)
      } catch (error) {
        console.error('Error fetching block discussions:', error)
        throw error
      }
    },
    retry: 1,
    staleTime: 30_000,
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

  if (targetRoute.uid == id.uid && targetRoute.path?.join('/') == id.path?.join('/')) {
    return null
  }

  return targetRoute
}

export function useDeleteComment() {
  const client = useUniversalClient()

  return useMutation({
    mutationFn: async (params: {comment: HMComment; signingAccountId: string}) => {
      if (!client.getSigner) {
        throw new Error('Signing not available on this platform')
      }
      const signer = client.getSigner(params.signingAccountId)
      const publishInput = await createDeleteCommentBlob(
        {
          commentId: params.comment.id,
          targetAccount: params.comment.targetAccount,
          targetPath: params.comment.targetPath || '',
          targetVersion: params.comment.targetVersion,
          visibility: params.comment.visibility === 'PRIVATE' ? 'Private' : '',
        },
        signer,
      )
      await client.publish(publishInput)
    },
    onSuccess: () => {
      // Invalidate all comment-related queries to refresh the UI
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
      invalidateQueries([queryKeys.ACTIVITY_FEED])
    },
  })
}

/** Mutation hook to edit an existing comment. */
export function useUpdateComment() {
  const client = useUniversalClient()

  return useMutation({
    mutationFn: async (params: {comment: HMComment; newContent: HMBlockNode[]; signingAccountId: string}) => {
      if (!client.getSigner) {
        throw new Error('Signing not available on this platform')
      }
      const signer = client.getSigner(params.signingAccountId)
      const publishInput = await createUpdateCommentBlob(
        {
          commentId: params.comment.id,
          targetAccount: params.comment.targetAccount,
          targetPath: params.comment.targetPath || '',
          targetVersion: params.comment.targetVersion,
          content: params.newContent,
          replyParentVersion: params.comment.replyParentVersion || null,
          rootReplyCommentVersion: params.comment.threadRootVersion || null,
          visibility: params.comment.visibility === 'PRIVATE' ? 'Private' : '',
        },
        signer,
      )
      await client.publish(publishInput)
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
      invalidateQueries([queryKeys.ACTIVITY_FEED])
      invalidateQueries([queryKeys.COMMENT_VERSIONS])
    },
  })
}

/** Query hook to fetch all versions (edit history) of a comment. */
export function useCommentVersions(commentId: string | null | undefined) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [queryKeys.COMMENT_VERSIONS, commentId],
    queryFn: async (): Promise<HMListCommentVersionsOutput> => {
      return await client.request('ListCommentVersions', {id: commentId!})
    },
    enabled: !!commentId,
    useErrorBoundary: false,
    staleTime: 60_000,
  })
}

export function useCommentReplyCount({id}: {id: string}) {
  const client = useUniversalClient()

  return useQuery({
    queryKey: [id, 'replyCount'],
    queryFn: () =>
      client.request('GetCommentReplyCount', {
        id,
      }),
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
