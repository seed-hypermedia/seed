import {reportError} from '@/errors'
import {domainResolver} from '@/grpc-client'
import {commentDraftQueryOptions} from '@/models/comments'
import {usePushAfterAction} from '@/models/push-after-action'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {handleDragMedia} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {createComment} from '@seed-hypermedia/client'
import {
  HMBlockNode,
  HMCommentDraftSchema,
  HMCommentGroup,
  HMComment,
  HMListDiscussionsOutput,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {CommentEditor, type CommentEditorSubmitHandle} from '@shm/editor/comment-editor'
import {hmId, queryClient, queryKeys} from '@shm/shared'
import {CONTENT_IMAGE_POLICY, processImageIfSupported} from '@shm/ui/image-processing'
import {BlockNode} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import type {InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {hasBlockContent} from '@shm/shared/content'
import {getMentionThreadContext, useDocumentComments} from '@shm/shared/models/comments'
import {useContacts} from '@shm/shared/models/contacts'
import {useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import type {CommentComposerInput} from '@shm/shared/models/comment-composer-machine'
import {useCommentComposer, useCommentComposerStatus} from '@shm/shared/models/use-comment-composer'
import {applyOptimisticComment, buildOptimisticComment, navigateToComment} from '@shm/shared/optimistic-comment'
import {useUniversalClient} from '@shm/shared/routing'
import {useNavRoute, useNavigation} from '@shm/shared/utils/navigation'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {Button} from '@shm/ui/button'
import {CommentAudience} from '@shm/ui/members-facepile'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {Check, SendHorizonal, X} from 'lucide-react'
import React, {memo, ReactNode, useCallback, useEffect, useMemo, useRef} from 'react'
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
    commentGroupAuthorsList.map((uid, index) => [uid, authorEntities[index].data]).filter(([k, v]) => !!v),
  )
}

export const CommentBox = memo(CommentBoxImpl)
function CommentBoxImpl(props: {
  /** Use the compact panel-footer editor. */
  compact?: boolean
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
  onCommentSubmitted?: (comment: HMComment) => void
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
  const navigation = useNavigation(undefined)
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
  const mentionThread = useMemo(
    () =>
      getMentionThreadContext(commentsService.data?.comments, {
        replyCommentId: commentId,
        replyCommentVersion: finalReplyVersion,
        rootReplyCommentVersion: finalRootVersion,
      }),
    [commentsService.data?.comments, commentId, finalReplyVersion, finalRootVersion],
  )

  const commentDraftQueryKey = [
    queryKeys.COMMENT_DRAFT,
    docId.id,
    commentId,
    quotingBlockId,
    quotingRange?.start,
    quotingRange?.end,
    context,
  ]
  const composerKey = 'desktop:' + JSON.stringify(commentDraftQueryKey)

  const submitHandleRef = useRef<CommentEditorSubmitHandle | null>(null)
  const getContentRef = useRef<
    Parameters<NonNullable<React.ComponentProps<typeof CommentEditor>['handleSubmit']>>[0] | null
  >(null)

  const composerInput = useMemo<CommentComposerInput>(
    () => ({
      loadDraft: async () => {
        const data = await queryClient.fetchQuery(
          commentDraftQueryOptions(
            quotingBlockId ? {...docId, blockRef: quotingBlockId, blockRange: quotingRange ?? null} : docId,
            commentId,
            quotingBlockId,
            quotingRange,
            context,
          ),
        )
        return data ? {blocks: HMCommentDraftSchema.parse(data).blocks} : null
      },
      saveDraft: async (content) => {
        await client.comments.writeCommentDraft.mutate({
          blocks: content.blocks.map((b) => BlockNode.fromJson(b as any)),
          targetDocId: docId.id,
          replyCommentId: commentId,
          quotingBlockId: quotingBlockId,
          quotingRange: quotingRange,
          context: context,
        })
        invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
        invalidateQueries(commentDraftQueryKey)
      },
      removeDraft: async () => {
        queryClient.setQueryData(commentDraftQueryKey, null)
        await client.comments.removeCommentDraft.mutate({
          targetDocId: docId.id,
          replyCommentId: commentId,
          quotingBlockId: quotingBlockId,
          quotingRange: quotingRange,
          context: context,
        })
        invalidateQueries([queryKeys.COMMENT_DRAFTS_LIST])
        invalidateQueries(commentDraftQueryKey)
      },
      publish: async ({content, accountUid}) => {
        if (!getSigner) throw new Error('getSigner not available')
        const targetDoc = targetEntity.data?.type === 'document' ? targetEntity.data.document : undefined
        const signer = getSigner(accountUid)
        if (accountUid !== docId.uid) {
          await subscribeContact({accountUid, subjectUid: docId.uid, subscribe: 'site'})
        }
        let capturedBlocks = content.blocks
        const getContent = getContentRef.current
        const payloadBase = {
          docId,
          docVersion: targetDoc?.version || docId.version || '',
          replyCommentVersion: finalReplyVersion,
          rootReplyCommentVersion: finalRootVersion,
          quoting,
          visibility: (targetDoc?.visibility === 'PRIVATE' ? 'Private' : '') as '' | 'Private',
        }
        const commentPayload = getContent
          ? await createComment(
              {
                ...payloadBase,
                getContent: async (
                  prepareAttachments: (binaries: Uint8Array[]) => Promise<{
                    blobs: {cid: string; data: Uint8Array}[]
                    resultCIDs: string[]
                  }>,
                ) => {
                  const result = await getContent(prepareAttachments)
                  capturedBlocks = result.blockNodes
                  return result
                },
              },
              signer,
            )
          : await createComment({...payloadBase, content: content.blocks} as any, signer)
        await queryClient.cancelQueries({queryKey: [queryKeys.DOCUMENT_COMMENTS, docId]})
        const authorMetadata: HMMetadataPayload | null =
          account && account.id.uid === accountUid ? {id: account.id, metadata: account.metadata || null} : null
        const optimisticComment = await buildOptimisticComment({
          commentPayload,
          authorUid: accountUid,
          docId,
          docVersion: targetDoc?.version || docId.version || '',
          contentBlocks: capturedBlocks,
          replyParentId: commentId || undefined,
          threadRootVersion: finalRootVersion,
          quoting,
          visibility: targetDoc?.visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        })
        const rollback = applyOptimisticComment(queryClient, docId, optimisticComment, authorMetadata, quoting)
        let response
        try {
          response = await publish(commentPayload)
          if (!response.cids[0]) throw new Error('Failed to publish comment blob')
        } catch (err) {
          rollback()
          throw err
        }
        const publishedComment = {...optimisticComment, version: response.cids[0]!}
        applyOptimisticComment(queryClient, docId, publishedComment, undefined, quoting)
        invalidateQueries([queryKeys.QUERY_BLOCK], {refetchType: 'all'})
        invalidateQueries([queryKeys.DOCUMENT_DISCUSSION, docId.uid, ...(docId.path || [])])
        invalidateQueries([queryKeys.LIST_ACCOUNTS])
        invalidateQueries([queryKeys.DOC_CITATIONS])
        invalidateQueries([queryKeys.SEARCH])
        invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])
        invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
        invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
        if (publishedComment.replyParent) invalidateQueries([queryKeys.COMMENT_REPLY_COUNT], {refetchType: 'all'})
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY])
        invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
        invalidateQueries([queryKeys.ACTIVITY_FEED])
        pushAfterAction({id: docId, trigger: 'publish'})
        client.recentSigners.writeRecentSigner.mutate(accountUid).then(() => {
          invalidateQueries([queryKeys.RECENT_SIGNERS])
        })
        return publishedComment
      },
    }),
    [
      docId,
      commentId,
      quotingBlockId,
      quotingRange,
      context,
      commentDraftQueryKey,
      getSigner,
      publish,
      subscribeContact,
      targetEntity.data,
      account,
      finalReplyVersion,
      finalRootVersion,
      quoting,
      pushAfterAction,
    ],
  )

  const actor = useCommentComposer(composerKey, composerInput)
  const {loading, busy} = useCommentComposerStatus(actor)

  const latestRef = useRef({route, navigate, navigation, accountIntent, onCommentSubmitted: props.onCommentSubmitted})
  latestRef.current = {
    route,
    navigate,
    navigation,
    accountIntent,
    onCommentSubmitted: props.onCommentSubmitted,
  }

  useEffect(() => {
    const subscriptions = [
      actor.on('editor.cleared', () => {
        submitHandleRef.current?.reset()
      }),
      actor.on('published', (event) => {
        const {navigate, route, navigation, onCommentSubmitted} = latestRef.current
        onCommentSubmitted?.(event.comment)
        navigateToComment(
          navigate,
          route,
          event.comment.id,
          navigation.state.get().routes[navigation.state.get().routeIndex] ?? route,
        )
      }),
      actor.on('account.required', () => {
        latestRef.current.accountIntent.requireAccount((accountUid) => {
          actor.send({type: 'account.ready', accountUid})
        })
      }),
      actor.on('publish.failed', (event) => {
        console.warn('Comment publish failed; draft retained:', event.error)
        reportError(event.error, {feature: 'comment', operation: 'publish', docId: docId.id})
        toast.error('Failed to post comment')
      }),
      actor.on('draft.saveFailed', (event) => {
        reportError(event.error, {feature: 'comment', operation: 'save-draft', docId: docId.id})
      }),
    ]
    return () => subscriptions.forEach((subscription) => subscription.unsubscribe())
  }, [actor, docId.id])

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

  const handleSubmit = useCallback(
    (
      getContent: (
        prepareAttachments: (binaries: Uint8Array[]) => Promise<{
          blobs: {cid: string; data: Uint8Array}[]
          resultCIDs: string[]
        }>,
      ) => Promise<{
        blockNodes: HMBlockNode[]
        blobs: {cid: string; data: Uint8Array}[]
      }>,
      _reset: () => void,
    ) => {
      getContentRef.current = getContent
      submitHandleRef.current?.flush()
      actor.send({type: 'submit.requested', accountUid: account?.id.uid ?? null})
    },
    [actor, account],
  )

  // Desktop file attachment handler
  const handleFileAttachment = useCallback(async (file: File) => {
    const attachment = await processImageIfSupported(file, CONTENT_IMAGE_POLICY)
    const props = await handleDragMedia(attachment)
    if (!props) {
      throw new Error('Failed to handle file')
    }
    return {
      // Return ipfs url for desktop
      url: props.url,
      displaySrc: '',
      mime: attachment.type,
      name: attachment.name,
    }
  }, [])

  const initialBlocks = useMemo(() => {
    if (loading) return undefined
    const blocks = actor.getSnapshot().context.content.blocks
    return blocks.length ? blocks : undefined
  }, [actor, loading])

  const handleContentChange = useCallback(
    (blocks: HMBlockNode[]) => actor.send({type: 'content.changed', content: {blocks}}),
    [actor],
  )
  const handleEditorBlur = useCallback(() => actor.send({type: 'content.flushRequested'}), [actor])

  if (loading) return null

  return (
    <>
      <CommentEditor
        compact={props.compact}
        referenceTarget={{documentId: docId.id, commentId}}
        focusOnMount={focusOnMount}
        isReplying={isReplying || !!commentId}
        readOnly={busy}
        submitHandleRef={submitHandleRef}
        handleSubmit={handleSubmit}
        initialBlocks={initialBlocks}
        onContentChange={handleContentChange}
        onEditorBlur={handleEditorBlur}
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
        perspectiveAccountUid={account?.id.uid ?? selectedAccountId}
        mentionThread={mentionThread}
        siteUid={docId.uid}
        documentId={docId}
        submitButton={({getContent, reset, disabled}) => (
          <Tooltip
            content={account ? `Publish Comment as "${account.metadata?.name}"` : 'Create an account to comment'}
          >
            <Button
              variant="default"
              size="icon"
              aria-label="Send comment"
              className={props.compact ? 'size-12 shrink-0 rounded-full' : undefined}
              onClick={(e) => {
                e.stopPropagation()
                handleSubmit(getContent, reset)
              }}
              disabled={busy || disabled}
            >
              <SendHorizonal className="size-4" />
            </Button>
          </Tooltip>
        )}
      />
      {props.compact && <CommentAudience docId={docId} />}
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
    const attachment = await processImageIfSupported(file, CONTENT_IMAGE_POLICY)
    const props = await handleDragMedia(attachment)
    if (!props) throw new Error('Failed to handle file')
    // Return ipfs url for desktop
    return {url: props.url, displaySrc: '', mime: attachment.type, name: attachment.name}
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
        perspectiveAccountUid={comment.author}
        siteUid={comment.targetAccount}
        documentId={hmId(comment.targetAccount, {path: entityQueryPathToHmIdPath(comment.targetPath)})}
        submitButton={({getContent, reset, disabled}) => (
          <>
            <Button variant="ghost" size="icon" onClick={onCancel} disabled={isSaving}>
              <X className="size-4" />
            </Button>
            <Tooltip content="Save edit">
              <Button
                variant="default"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation()
                  handleSubmit(getContent, reset)
                }}
                disabled={isSaving || disabled}
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
