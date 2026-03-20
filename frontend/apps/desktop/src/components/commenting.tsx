import {useCommentDraft} from '@/models/comments'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {handleDragMedia} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {createComment} from '@seed-hypermedia/client'
import {
  HMBlockNode,
  HMCommentGroup,
  HMListDiscussionsOutput,
  HMMetadataPayload,
  HMPublishBlobsInput,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {CommentEditor} from '@shm/editor/comment-editor'
import {queryClient, queryKeys} from '@shm/shared'
import {BlockNode} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {useCommentsService} from '@shm/shared/comments-service-provider'
import {useContacts} from '@shm/shared/models/contacts'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {applyOptimisticComment, buildOptimisticComment, navigateToComment} from '@shm/shared/optimistic-comment'
import {useUniversalClient} from '@shm/shared/routing'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Tooltip} from '@shm/ui/tooltip'
import {useMutation} from '@tanstack/react-query'
import {Check, SendHorizonal, X} from 'lucide-react'
import {memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'

export function useCommentGroupAuthors(commentGroups: HMCommentGroup[]): HMListDiscussionsOutput['authors'] {
  const commentGroupAuthors = new Set<string>()
  commentGroups.forEach((commentGroup) => {
    commentGroup.comments.forEach((comment) => {
      commentGroupAuthors.add(comment.author)
    })
  })
  const commentGroupAuthorsList = Array.from(commentGroupAuthors)
  const authorEntities = useContacts(commentGroupAuthorsList)
  return Object.fromEntries(
    commentGroupAuthorsList
      // @ts-ignore
      .map((uid, index) => [uid, authorEntities[index].data])
      .filter(([k, v]) => !!v),
  )
}

export const CommentBox = memo(_CommentBox)
function _CommentBox(props: {
  docId: UnpackedHypermediaId
  backgroundColor?: string
  quotingBlockId?: string
  commentId?: string
  isReplying?: boolean
  autoFocus?: boolean
  context?: 'accessory' | 'feed' | 'document-content'
  /** CID version of the comment being replied to, passed from the route. */
  replyCommentVersion?: string
  /** CID version of the thread root comment, passed from the route. */
  rootReplyCommentVersion?: string
}) {
  const {docId, quotingBlockId, commentId, isReplying, autoFocus, context} = props

  const account = useSelectedAccount()
  const selectedAccountId = useSelectedAccountId()
  const targetEntity = useResource(docId)
  const {getSigner, publish} = useUniversalClient()
  const route = useNavRoute()
  const navigate = useNavigate('replace')

  // Resolve reply parent: commentId is an ID like "author/path", but publishing uses CID versions
  const commentsService = useCommentsService({targetId: docId})
  const resolvedReply = useMemo(() => {
    if (!commentId) return null
    const comment = commentsService.data?.comments?.find((c) => c.id === commentId)
    if (!comment) return null
    return {
      replyCommentVersion: comment.version,
      rootReplyCommentVersion: comment.threadRootVersion || comment.version,
    }
  }, [commentId, commentsService.data?.comments])

  // Use route-provided version data first, fall back to resolved values from comments service
  const finalReplyVersion = props.replyCommentVersion || resolvedReply?.replyCommentVersion
  const finalRootVersion = props.rootReplyCommentVersion || resolvedReply?.rootReplyCommentVersion

  const draft = useCommentDraft(
    quotingBlockId ? {...docId, blockRef: quotingBlockId} : docId,
    commentId,
    quotingBlockId,
    context,
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDeletingDraft = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()

  // Clean up save timeout on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const commentDraftQueryKey = [queryKeys.COMMENT_DRAFT, docId.id, commentId, quotingBlockId, context]

  // Draft write mutation
  const writeDraft = useMutation({
    mutationFn: (blocks: HMBlockNode[]) =>
      client.comments.writeCommentDraft.mutate({
        blocks: blocks.map((b) => BlockNode.fromJson(b as any)),
        targetDocId: docId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        context: context,
      }),
    onSuccess: () => {
      invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
    },
  })

  // Draft remove mutation
  const removeDraft = useMutation({
    mutationFn: () =>
      client.comments.removeCommentDraft.mutate({
        targetDocId: docId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        context: context,
      }),
    onMutate: async () => {
      isDeletingDraft.current = true
      clearTimeout(saveTimeoutRef.current)
      await queryClient.cancelQueries({queryKey: commentDraftQueryKey})
      queryClient.setQueryData(commentDraftQueryKey, null)
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
      invalidateQueries(commentDraftQueryKey)
      isDeletingDraft.current = false
    },
    onError: () => {
      isDeletingDraft.current = false
    },
  })

  // Recent signer mutation
  const writeRecentSigner = useMutation({
    mutationFn: (signingKeyName: string) => client.recentSigners.writeRecentSigner.mutate(signingKeyName),
  })

  // Publish comment mutation
  type PublishCommentVars = {commentPayload: HMPublishBlobsInput; contentBlocks: HMBlockNode[]}

  const publishComment = useMutation({
    mutationFn: async ({commentPayload}: PublishCommentVars) => {
      const response = await publish(commentPayload)
      if (!response.cids[0]) throw new Error('Failed to publish comment blob')
      return response
    },
    onMutate: async ({commentPayload, contentBlocks}: PublishCommentVars) => {
      await queryClient.cancelQueries({queryKey: [queryKeys.DOCUMENT_COMMENTS, docId]})

      const targetDoc = targetEntity.data?.type === 'document' ? targetEntity.data.document : undefined
      const authorMetadata: HMMetadataPayload | null = account
        ? {id: account.id, metadata: account.metadata || null}
        : null

      const optimisticComment = await buildOptimisticComment({
        commentPayload,
        authorUid: account!.id.uid,
        docId,
        docVersion: targetDoc?.version || docId.version || '',
        contentBlocks,
        replyParentId: commentId || undefined,
        threadRootVersion: finalRootVersion,
        quotingBlockId,
        visibility: targetDoc?.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
      })

      applyOptimisticComment(queryClient, docId, optimisticComment, authorMetadata, quotingBlockId)
      navigateToComment(navigate, route, optimisticComment.id)
    },
    onError: (err: {message: string}) => {
      // Keep the optimistic comment visible — the publish can be retried later.
      // Do NOT roll back cache or navigation; do NOT invalidate queries (would fail offline).
      setIsSubmitting(false)
      console.warn('Comment publish failed, keeping optimistic comment:', err.message)
    },
    onSuccess: () => {
      setIsSubmitting(false)
      isDeletingDraft.current = true
      clearTimeout(saveTimeoutRef.current)

      removeDraft.mutate()

      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION, docId.uid, ...(docId.path || [])])
      invalidateQueries([queryKeys.LIBRARY])
      invalidateQueries([queryKeys.SITE_LIBRARY, docId.uid])
      invalidateQueries([queryKeys.LIST_ACCOUNTS])
      invalidateQueries([queryKeys.DOC_CITATIONS])

      invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY])
      invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
      invalidateQueries([queryKeys.ACTIVITY_FEED])
    },
  })

  // Clear autoFocus from route after used
  useEffect(() => {
    if (autoFocus && route.key === 'document' && route.panel?.key === 'activity') {
      const panel = route.panel
      if (panel.autoFocus) {
        setTimeout(() => {
          const {autoFocus: _, ...restPanel} = panel
          navigate({...route, panel: restPanel})
        }, 150)
      }
    }
  }, [autoFocus])

  // Handle content changes - save draft
  const handleContentChange = useCallback(
    (blocks: HMBlockNode[]) => {
      if (isDeletingDraft.current) return

      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        const hasContent = blocks.some(
          (block) =>
            // @ts-expect-error - text exists on paragraph/heading blocks
            (block.block?.text && block.block.text.trim()) || (block.children && block.children.length > 0),
        )

        if (!hasContent) {
          if (draft.data) {
            removeDraft.mutate()
          }
          return
        }

        writeDraft.mutate(blocks)
      }, 500)
    },
    [draft.data, writeDraft, removeDraft],
  )

  // Handle submit
  const handleSubmit = useCallback(
    async (
      getContent: (
        prepareAttachments: (binaries: Uint8Array[]) => Promise<{
          blobs: {cid: string; data: Uint8Array}[]
          resultCIDs: string[]
        }>,
      ) => Promise<{
        blockNodes: HMBlockNode[]
        blobs: {cid: string; data: Uint8Array}[]
      }>,
      reset: () => void,
    ) => {
      if (isSubmitting || !account) return

      setIsSubmitting(true)

      try {
        if (!getSigner) throw new Error('getSigner not available')
        const targetDoc = targetEntity.data?.type === 'document' ? targetEntity.data.document : undefined
        const targetVersion = targetDoc?.version
        const signer = getSigner(account.id.uid)

        // Wrap getContent to capture block nodes before they're consumed by createComment
        let capturedBlocks: HMBlockNode[] = []
        const wrappedGetContent: typeof getContent = async (prepareAttachments) => {
          const result = await getContent(prepareAttachments)
          capturedBlocks = result.blockNodes
          return result
        }

        const commentPayload = await createComment(
          {
            getContent: wrappedGetContent,
            docId,
            docVersion: targetVersion || docId.version || '',
            replyCommentVersion: finalReplyVersion,
            rootReplyCommentVersion: finalRootVersion,
            quotingBlockId,
            visibility: targetDoc?.visibility === 'PRIVATE' ? 'Private' : '',
          },
          signer,
        )

        await publishComment.mutateAsync({commentPayload, contentBlocks: capturedBlocks})

        writeRecentSigner.mutateAsync(account.id.uid).then(() => {
          invalidateQueries([queryKeys.RECENT_SIGNERS])
        })

        reset()
      } catch (err) {
        setIsSubmitting(false)
        console.error('Failed to submit comment:', err)
      }
    },
    [
      isSubmitting,
      account,
      publishComment,
      getSigner,
      targetEntity.data,
      docId,
      finalReplyVersion,
      finalRootVersion,
      quotingBlockId,
      writeRecentSigner,
    ],
  )

  // Desktop file attachment handler
  const handleFileAttachment = useCallback(async (file: File) => {
    const props = await handleDragMedia(file)
    if (!props) {
      throw new Error('Failed to handle file')
    }
    return {
      displaySrc: props.url,
      // Desktop uploads files immediately and returns URL, no binary needed
    }
  }, [])

  if (draft.isInitialLoading) return null

  if (!account) {
    return (
      <div className="flex w-full items-start gap-2">
        <span className="text-sm font-thin italic">No account is loaded</span>
      </div>
    )
  }

  return (
    <CommentEditor
      autoFocus={autoFocus}
      isReplying={isReplying || !!commentId}
      handleSubmit={handleSubmit}
      initialBlocks={draft.data?.blocks}
      onContentChange={handleContentChange}
      handleFileAttachment={handleFileAttachment}
      account={{
        id: account.id,
        metadata: account.metadata,
      }}
      perspectiveAccountUid={selectedAccountId}
      submitButton={({getContent, reset}) => (
        <Tooltip content={`Publish Comment as "${account?.metadata?.name}"`}>
          <Button
            size="icon"
            onClick={(e) => {
              e.stopPropagation()
              handleSubmit(getContent, reset)
            }}
            disabled={isSubmitting}
          >
            <SendHorizonal className="size-4" />
          </Button>
        </Tooltip>
      )}
    />
  )
}

export function triggerCommentDraftFocus(docId: string, commentId?: string) {
  const focusKey = `${docId}-${commentId}`
  const subscribers = focusSubscribers.get(focusKey)
  if (subscribers) {
    subscribers.forEach((fn) => fn())
  }
}

const focusSubscribers = new Map<string, Set<() => void>>()

/** Renders a CommentEditor pre-filled with the comment's content for inline editing. */
export function renderDesktopInlineEditor({comment, onSave, onCancel, isSaving}: InlineEditCommentProps): ReactNode {
  return <InlineEditBox comment={comment} onSave={onSave} onCancel={onCancel} isSaving={isSaving} />
}

/** Inline comment editor used when editing an existing comment in-place. */
function InlineEditBox({comment, onSave, onCancel, isSaving}: InlineEditCommentProps) {
  const account = useSelectedAccount()
  const selectedAccountId = useSelectedAccountId()
  const contentRef = useRef<HMBlockNode[]>(comment.content)

  const handleFileAttachment = useCallback(async (file: File) => {
    const props = await handleDragMedia(file)
    if (!props) throw new Error('Failed to handle file')
    return {displaySrc: props.url}
  }, [])

  const handleSubmit = useCallback(
    async (
      getContent: (
        prepareAttachments: (binaries: Uint8Array[]) => Promise<{
          blobs: {cid: string; data: Uint8Array}[]
          resultCIDs: string[]
        }>,
      ) => Promise<{blockNodes: HMBlockNode[]; blobs: {cid: string; data: Uint8Array}[]}>,
      reset: () => void,
    ) => {
      const {blockNodes} = await getContent(async (binaries) => ({blobs: [], resultCIDs: []}))
      onSave(blockNodes)
    },
    [onSave],
  )

  return (
    <div className="flex flex-col gap-2">
      <CommentEditor
        autoFocus
        isReplying={false}
        handleSubmit={handleSubmit}
        initialBlocks={comment.content}
        handleFileAttachment={handleFileAttachment}
        account={account ? {id: account.id, metadata: account.metadata} : undefined}
        perspectiveAccountUid={selectedAccountId}
        submitButton={({getContent, reset}) => (
          <>
            <Button variant="ghost" size="icon" onClick={onCancel} disabled={isSaving}>
              <X className="size-4" />
            </Button>
            <Tooltip content="Save edit">
              <Button
                size="icon"
                onClick={(e) => {
                  e.stopPropagation()
                  handleSubmit(getContent, reset)
                }}
                disabled={isSaving}
              >
                <Check className="size-4" />
              </Button>
            </Tooltip>
          </>
        )}
      />
    </div>
  )
}
