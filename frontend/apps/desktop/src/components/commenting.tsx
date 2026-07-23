import {reportError} from '@/errors'
import {domainResolver} from '@/grpc-client'
import {useCommentDraft} from '@/models/comments'
import {usePushAfterAction} from '@/models/push-after-action'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {handleDragMedia} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {commentRecordIdFromBlob, createComment} from '@seed-hypermedia/client'
import {
  HMBlockNode,
  HMCommentGroup,
  HMListDiscussionsOutput,
  HMMetadataPayload,
  HMPublishBlobsInput,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {CommentEditor, type CommentEditorSubmitHandle} from '@shm/editor/comment-editor'
import {queryClient, queryKeys} from '@shm/shared'
import {BlockNode} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {hasBlockContent} from '@shm/shared/content'
import {useDocumentComments} from '@shm/shared/models/comments'
import {useContacts} from '@shm/shared/models/contacts'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {applyOptimisticComment, buildOptimisticComment, navigateToComment} from '@shm/shared/optimistic-comment'
import {useUniversalClient} from '@shm/shared/routing'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useMutation} from '@tanstack/react-query'
import {Check, SendHorizonal, X} from 'lucide-react'
import React, {memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useContactSubscribeIntent, useDesktopAccountIntent} from './desktop-intents'

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

export const CommentBox = memo(CommentBoxImpl)
function CommentBoxImpl(props: {
  docId: UnpackedHypermediaId
  backgroundColor?: string
  quotingBlockId?: string
  /** Codepoint range within the quoted block; absent ⇒ whole-block quote. */
  quotingRange?: {start: number; end: number}
  commentId?: string
  isReplying?: boolean
  /** Focus the editor on mount (renamed from `autoFocus` to satisfy a11y rules). */
  focusOnMount?: boolean
  context?: 'accessory' | 'feed' | 'document-content'
  /** CID version of the comment being replied to, passed from the route. */
  replyCommentVersion?: string
  /** CID version of the thread root comment, passed from the route. */
  rootReplyCommentVersion?: string
}) {
  const {docId, quotingBlockId, quotingRange, commentId, isReplying, focusOnMount, context} = props
  const quoting = useMemo(
    () => (quotingBlockId ? {blockId: quotingBlockId, range: quotingRange} : undefined),
    [quotingBlockId, quotingRange?.start, quotingRange?.end],
  )

  const account = useSelectedAccount()
  const selectedAccountId = useSelectedAccountId()
  const targetEntity = useResource(docId)
  const pushAfterAction = usePushAfterAction()
  const universalClient = useUniversalClient()
  const {getSigner, publish} = universalClient
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const accountIntent = useDesktopAccountIntent()
  const subscribeContact = useContactSubscribeIntent()

  // Resolve reply parent: commentId is an ID like "author/path", but publishing uses CID versions
  const commentsService = useDocumentComments(docId)
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
    quotingBlockId ? {...docId, blockRef: quotingBlockId, blockRange: quotingRange ?? null} : docId,
    commentId,
    quotingBlockId,
    quotingRange,
    context,
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDeletingDraft = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout>()
  const pendingBlocksRef = useRef<HMBlockNode[] | null>(null)
  const latestBlocksRef = useRef<HMBlockNode[] | null>(null)
  const submitHandleRef = useRef<CommentEditorSubmitHandle | null>(null)
  const flushPendingDraftSaveRef = useRef<() => void>(() => {})

  const commentDraftQueryKey = [
    queryKeys.COMMENT_DRAFT,
    docId.id,
    commentId,
    quotingBlockId,
    quotingRange?.start,
    quotingRange?.end,
    context,
  ]

  // Draft write mutation
  const writeDraft = useMutation({
    mutationFn: (blocks: HMBlockNode[]) =>
      client.comments.writeCommentDraft.mutate({
        blocks: blocks.map((b) => BlockNode.fromJson(b as any)),
        targetDocId: docId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        quotingRange: quotingRange,
        context: context,
      }),
    onSuccess: () => {
      invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
      invalidateQueries(commentDraftQueryKey)
    },
  })

  // Draft remove mutation
  const removeDraft = useMutation({
    mutationFn: () =>
      client.comments.removeCommentDraft.mutate({
        targetDocId: docId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        quotingRange: quotingRange,
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
        quoting,
        visibility: targetDoc?.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
      })

      applyOptimisticComment(queryClient, docId, optimisticComment, authorMetadata, quoting)
      navigateToComment(navigate, route, optimisticComment.id)
    },
    onError: (err: {message: string}) => {
      // Keep the optimistic comment visible — the publish can be retried later.
      // Do NOT roll back cache or navigation; do NOT invalidate queries (would fail offline).
      setIsSubmitting(false)
      console.warn('Comment publish failed, keeping optimistic comment:', err.message)
      reportError(err, {
        feature: 'comment',
        operation: 'publish',
        docId: docId.id,
      })
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
      invalidateQueries([queryKeys.SEARCH])

      invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY])
      invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
      invalidateQueries([queryKeys.ACTIVITY_FEED])

      pushAfterAction({id: docId, trigger: 'publish'})
    },
  })

  // Clear focusOnMount from route after used
  useEffect(() => {
    if (focusOnMount && route.key === 'document' && route.panel?.key === 'activity') {
      const panel = route.panel
      if (panel.autoFocus) {
        setTimeout(() => {
          const {autoFocus: _, ...restPanel} = panel
          navigate({...route, panel: restPanel})
        }, 150)
      }
    }
  }, [focusOnMount])

  // Handle content changes - save draft
  const saveDraftBlocks = useCallback(
    (blocks: HMBlockNode[]) => {
      if (isDeletingDraft.current) return

      const hasContent = blocks.some(hasBlockContent)

      if (!hasContent) {
        if (draft.data) {
          removeDraft.mutate()
        }
        return
      }

      writeDraft.mutate(blocks)
    },
    [draft.data, writeDraft, removeDraft],
  )

  const flushPendingDraftSave = useCallback(() => {
    if (!pendingBlocksRef.current) return

    const blocks = pendingBlocksRef.current
    pendingBlocksRef.current = null
    clearTimeout(saveTimeoutRef.current)
    saveDraftBlocks(blocks)
  }, [saveDraftBlocks])

  flushPendingDraftSaveRef.current = flushPendingDraftSave

  // Clean up save timeout on unmount, but persist the pending draft first.
  useEffect(() => {
    return () => {
      flushPendingDraftSaveRef.current()
    }
  }, [])

  const handleContentChange = useCallback(
    (blocks: HMBlockNode[]) => {
      if (isDeletingDraft.current) return

      latestBlocksRef.current = blocks
      pendingBlocksRef.current = blocks
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        flushPendingDraftSave()
      }, 500)
    },
    [flushPendingDraftSave],
  )

  const publishStoredComment = useCallback(
    async (accountUid: string, contentBlocks: HMBlockNode[], reset: () => void) => {
      if (!getSigner) throw new Error('getSigner not available')
      setIsSubmitting(true)
      try {
        const targetDoc = targetEntity.data?.type === 'document' ? targetEntity.data.document : undefined
        const signer = getSigner(accountUid)
        const joinedSite = accountUid !== docId.uid
        if (joinedSite) {
          await subscribeContact({accountUid, subjectUid: docId.uid, subscribe: 'site'})
        }
        const commentPayload = await createComment(
          {
            content: contentBlocks,
            docId,
            docVersion: targetDoc?.version || docId.version || '',
            replyCommentVersion: finalReplyVersion,
            rootReplyCommentVersion: finalRootVersion,
            quoting,
            visibility: targetDoc?.visibility === 'PRIVATE' ? 'Private' : '',
          } as any,
          signer,
        )
        const commentBlobData = commentPayload.blobs[0]?.data
        if (!commentBlobData) throw new Error('No comment blob data')
        const recordId = await commentRecordIdFromBlob(commentBlobData)
        await publish(commentPayload)
        removeDraft.mutate()
        invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
        invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY])
        invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
        navigateToComment(navigate, route, recordId)
        pushAfterAction({id: docId, trigger: 'publish'})
        reset()
        toast.success(joinedSite ? 'Joined site and posted comment' : 'Comment posted')
      } catch (err) {
        console.error('Failed to submit pending comment:', err)
        reportError(err, {feature: 'comment', operation: 'submit-pending', docId: docId.id})
        toast.error('Failed to post comment')
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      docId,
      finalReplyVersion,
      finalRootVersion,
      getSigner,
      navigate,
      publish,
      pushAfterAction,
      quoting,
      removeDraft,
      route,
      subscribeContact,
      targetEntity.data,
    ],
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
      if (isSubmitting) return

      // Content changes are debounced in the editor; flush so latestBlocksRef
      // holds the final content before reading it below.
      submitHandleRef.current?.flush()

      if (!account) {
        const contentBlocks = latestBlocksRef.current || draft.data?.blocks || []
        if (!contentBlocks.some(hasBlockContent)) return
        accountIntent.requireAccount((accountUid) => publishStoredComment(accountUid, contentBlocks, reset))
        return
      }

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
            quoting,
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
        reportError(err, {
          feature: 'comment',
          operation: 'submit',
          docId: docId.id,
        })
      }
    },
    [
      isSubmitting,
      account,
      accountIntent,
      draft.data?.blocks,
      publishComment,
      publishStoredComment,
      getSigner,
      targetEntity.data,
      docId,
      finalReplyVersion,
      finalRootVersion,
      quotingBlockId,
      quotingRange?.start,
      quotingRange?.end,
      quoting,
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
      // Return ipfs url for desktop
      url: props.url,
      displaySrc: '',
    }
  }, [])

  if (draft.isInitialLoading) return null

  return (
    <>
      <CommentEditor
        focusOnMount={focusOnMount}
        isReplying={isReplying || !!commentId}
        submitHandleRef={submitHandleRef}
        handleSubmit={handleSubmit}
        initialBlocks={draft.data?.blocks}
        onContentChange={handleContentChange}
        handleFileAttachment={handleFileAttachment}
        universalClient={universalClient}
        domainResolver={domainResolver}
        account={
          account
            ? {
                id: account.id,
                metadata: account.metadata,
              }
            : undefined
        }
        perspectiveAccountUid={selectedAccountId}
        submitButton={({getContent, reset}) => (
          <Tooltip
            content={account ? `Publish Comment as "${account.metadata?.name}"` : 'Create an account to comment'}
          >
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
      {accountIntent.content}
    </>
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
  const universalClient = useUniversalClient()
  const contentRef = useRef<HMBlockNode[]>(comment.content)

  const handleFileAttachment = useCallback(async (file: File) => {
    const props = await handleDragMedia(file)
    if (!props) throw new Error('Failed to handle file')
    // Return ipfs url for desktop
    return {url: props.url, displaySrc: ''}
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
        focusOnMount
        isReplying={false}
        handleSubmit={handleSubmit}
        initialBlocks={comment.content}
        handleFileAttachment={handleFileAttachment}
        universalClient={universalClient}
        domainResolver={domainResolver}
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
