import {grpcClient} from '@/grpc-client'
import {useCommentDraft} from '@/models/comments'
import {usePushResource} from '@/models/documents'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {handleDragMedia} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {toPlainMessage} from '@bufbuild/protobuf'
import {CommentEditor} from '@shm/editor/comment-editor'
import {commentIdToHmId, packHmId, queryClient, queryKeys} from '@shm/shared'
import {BlockNode} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {
  HMBlockNode,
  HMCommentGroup,
  HMListDiscussionsOutput,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useContacts, useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useMutation} from '@tanstack/react-query'
import {SendHorizonal} from 'lucide-react'
import {nanoid} from 'nanoid'
import {memo, useCallback, useEffect, useRef, useState} from 'react'

export function useCommentGroupAuthors(
  commentGroups: HMCommentGroup[],
): HMListDiscussionsOutput['authors'] {
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
  autoFocus?: boolean
  context?: 'accessory' | 'feed' | 'document-content'
}) {
  const {docId, quotingBlockId, commentId, autoFocus, context} = props

  const account = useSelectedAccount()
  const selectedAccountId = useSelectedAccountId()
  const targetEntity = useResource(docId)
  const pushResource = usePushResource()
  const route = useNavRoute()
  const navigate = useNavigate('replace')

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

  const commentDraftQueryKey = [
    queryKeys.COMMENT_DRAFT,
    docId.id,
    commentId,
    quotingBlockId,
    context,
  ]

  // Draft write mutation
  const writeDraft = useMutation({
    mutationFn: (blocks: HMBlockNode[]) =>
      client.comments.writeCommentDraft.mutate({
        blocks: blocks.map((b) => new BlockNode(b as any)),
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
    mutationFn: (signingKeyName: string) =>
      client.recentSigners.writeRecentSigner.mutate(signingKeyName),
  })

  // Publish comment mutation
  const publishComment = useMutation({
    mutationFn: async ({
      content,
      signingKeyName,
    }: {
      content: BlockNode[]
      signingKeyName: string
    }) => {
      // When quoting a block, include the version to ensure we reference
      // the specific version containing the block
      const targetDoc =
        targetEntity.data?.type === 'document'
          ? targetEntity.data.document
          : undefined
      const targetVersion = targetDoc?.version
      const publishContent = quotingBlockId
        ? [
            new BlockNode({
              block: {
                id: nanoid(8),
                type: 'Embed',
                text: '',
                attributes: {
                  childrenType: 'Group',
                  view: 'Content',
                } as any,
                annotations: [],
                link: packHmId({
                  ...docId,
                  blockRef: quotingBlockId,
                  version: targetVersion || docId.version,
                }),
              },
              children: content,
            }),
          ]
        : content

      const resultComment = await grpcClient.comments.createComment({
        content: publishContent,
        replyParent: commentId || undefined,
        targetAccount: docId.uid,
        targetPath: hmIdPathToEntityQueryPath(docId.path),
        signingKeyName,
        // @ts-expect-error
        targetVersion: targetEntity.data?.document?.version!,
      })

      writeRecentSigner.mutateAsync(signingKeyName).then(() => {
        invalidateQueries([queryKeys.RECENT_SIGNERS])
      })

      if (!resultComment) throw new Error('no resultComment')
      return toPlainMessage(resultComment)
    },
    onSuccess: (newComment) => {
      setIsSubmitting(false)
      isDeletingDraft.current = true
      clearTimeout(saveTimeoutRef.current)

      removeDraft.mutate()

      // Invalidate queries
      invalidateQueries([
        queryKeys.DOCUMENT_DISCUSSION,
        docId.uid,
        ...(docId.path || []),
      ])
      invalidateQueries([queryKeys.LIBRARY])
      invalidateQueries([queryKeys.SITE_LIBRARY, docId.uid])
      invalidateQueries([queryKeys.LIST_ACCOUNTS])
      invalidateQueries([queryKeys.DOC_CITATIONS])

      // Invalidate additional queries
      queryClient.invalidateQueries({queryKey: [queryKeys.DOCUMENT_ACTIVITY]})
      queryClient.invalidateQueries({queryKey: [queryKeys.DOCUMENT_DISCUSSION]})
      queryClient.invalidateQueries({queryKey: [queryKeys.DOCUMENT_COMMENTS]})
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY],
      })
      queryClient.invalidateQueries({queryKey: [queryKeys.BLOCK_DISCUSSIONS]})
      queryClient.invalidateQueries({queryKey: [queryKeys.ACTIVITY_FEED]})

      pushResource(commentIdToHmId(newComment.id))
    },
    onError: (err: {message: string}) => {
      setIsSubmitting(false)
      toast.error(`Failed to create comment: ${err.message}`)
    },
  })

  // Clear autoFocus from route after used
  useEffect(() => {
    if (
      autoFocus &&
      route.key === 'document' &&
      route.panel?.key === 'activity'
    ) {
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
            (block.block?.text && block.block.text.trim()) ||
            (block.children && block.children.length > 0),
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
        // For desktop, we handle file uploads differently - files are already uploaded
        // So we just need to get the content without re-uploading
        const {blockNodes} = await getContent(async (binaries) => {
          // Desktop handles media uploads inline via handleDragMedia
          // which already returns URLs, so no additional upload needed
          return {blobs: [], resultCIDs: []}
        })

        // Convert to BlockNode for gRPC
        const content = blockNodes.map((b) => new BlockNode(b as any))

        await publishComment.mutateAsync({
          content,
          signingKeyName: account.id.uid,
        })

        reset()
      } catch (err) {
        setIsSubmitting(false)
        console.error('Failed to submit comment:', err)
      }
    },
    [isSubmitting, account, publishComment],
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
      handleSubmit={handleSubmit}
      initialBlocks={draft.data?.blocks}
      onContentChange={handleContentChange}
      handleFileAttachment={handleFileAttachment}
      account={{
        id: account.id,
        metadata: account.document?.metadata,
      }}
      perspectiveAccountUid={selectedAccountId}
      submitButton={({getContent, reset}) => (
        <Tooltip
          content={`Publish Comment as "${account?.document?.metadata?.name}"`}
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
