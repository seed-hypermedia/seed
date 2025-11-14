// @ts-expect-error
import type {BlockNoteEditor} from '@/editor/BlockNoteEditor'
import {grpcClient} from '@/grpc-client'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {getSlashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {useBlockNote, type BlockSchema} from '@shm/editor/blocknote'
import {createHypermediaDocLinkPlugin} from '@shm/editor/hypermedia-link-plugin'
import {
  removeTrailingBlocks,
  serverBlockNodesFromEditorBlocks,
} from '@shm/editor/utils'
import {packHmId} from '@shm/shared'
import {BlockNode} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {BIG_INT} from '@shm/shared/constants'
import {hasBlockContent} from '@shm/shared/content'
import {GRPCClient} from '@shm/shared/grpc-client'
import {
  HMBlockNode,
  HMBlockNodeSchema,
  HMComment,
  HMCommentDraft,
  HMCommentDraftSchema,
  HMDocumentMetadataSchema,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {toast} from '@shm/ui/toast'
import {UseQueryOptions, useMutation, useQuery} from '@tanstack/react-query'
import {Extension} from '@tiptap/core'
import {nanoid} from 'nanoid'
import {useEffect, useMemo, useRef, useState} from 'react'
import {hmBlockSchema} from '../editor'
import {setGroupTypes} from './editor-utils'
import {useGatewayUrlStream} from './gateway-settings'
import {siteDiscover} from './web-links'

// TODO: REMOVE THIS
export function useCommentReplies(
  targetCommentId: string,
  targetDocId: UnpackedHypermediaId | undefined,
) {
  const comments = useAllDiscussions(targetDocId)
  return useMemo(() => {
    const thread = comments.data?.filter(
      (c) => c.replyParent === targetCommentId,
    )
    return thread
  }, [comments.data, targetCommentId])
}

export function useCommentDraft(
  targetDocId: UnpackedHypermediaId,
  commentId: string | undefined,
  quotingBlockId: string | undefined,
  context: 'accessory' | 'feed' | 'document-content' | undefined,
  opts?: Parameters<typeof trpc.comments.getCommentDraft.useQuery>[1],
) {
  const comment = trpc.comments.getCommentDraft.useQuery(
    {
      targetDocId: targetDocId.id,
      replyCommentId: commentId,
      quotingBlockId: quotingBlockId,
      context: context,
    },
    opts,
  )
  return {
    ...comment,
    data: comment.data ? HMCommentDraftSchema.parse(comment.data) : undefined,
  }
}

function queryComment(
  grpcClient: GRPCClient,
  commentId: UnpackedHypermediaId | null | undefined,
  opts?: UseQueryOptions<HMComment | null>,
) {
  return {
    // ...opts,
    queryKey: [queryKeys.COMMENT, commentId],
    enabled: opts?.enabled !== false && !!commentId,
    queryFn: async () => {
      if (!commentId) return null
      try {
        const tsId = commentId.path?.[0]
        if (!tsId) {
          console.warn(
            'commentId provided to queryComment with no tsId',
            commentId,
          )
          return null
        }
        const comment = await grpcClient.comments.getComment({
          id: commentId.uid + '/' + tsId,
        })
        return toPlainMessage(comment) as HMComment
      } catch (error: any) {
        // Handle ConnectError for NotFound comments gracefully
        if (
          error?.code === 'not_found' ||
          error?.message?.includes('not found')
        ) {
          console.warn(
            `Comment ${commentId} not found, treating as acceptable warning`,
          )
          return null
        }
        // Re-throw other errors
        throw error
      }
    },
  }
}

// TODO: REMOVE THIS
export function useComment(
  id: UnpackedHypermediaId | null | undefined,
  opts?: UseQueryOptions<HMComment | null>,
) {
  return useQuery(queryComment(grpcClient, id, opts))
}

// TODO: REMOVE THIS
export function useComments(commentIds: UnpackedHypermediaId[] = []) {
  return useQuery({
    queryKey: [queryKeys.COMMENTS_BATCH],
    queryFn: async function () {
      const res = await grpcClient.comments.batchGetComments({
        ids: commentIds.map((c) => c.id),
      })
      return res.comments.map((comment) => {
        const plain = toPlainMessage(comment)
        return {
          ...plain,
          content: plain.content.map((blockNode) => {
            const parsed = HMBlockNodeSchema.safeParse(blockNode)
            return parsed.success ? parsed.data : blockNode
          }),
        } as HMComment
      })
    },
  })
}

// TODO: REMOVE THIS
export function useAllDiscussions(
  docId: UnpackedHypermediaId | null | undefined,
  opts?: {enabled?: boolean},
) {
  return useQuery({
    queryFn: async () => {
      if (!docId) return []
      let res = await grpcClient.comments.listComments({
        targetAccount: docId.uid,
        targetPath: hmIdPathToEntityQueryPath(docId.path),
        pageSize: BIG_INT,
      })
      return res.comments.map((c) => {
        const json = c.toJson({emitDefaultValues: true}) as any
        return {
          ...json,
          content:
            json.content?.map((blockNode: any) => {
              const parsed = HMBlockNodeSchema.safeParse(blockNode)
              return parsed.success ? parsed.data : blockNode
            }) || [],
        } as HMComment
      })
    },
    enabled: !!docId && opts?.enabled !== false,
    refetchInterval: 10_000,
    queryKey: [
      queryKeys.DOCUMENT_DISCUSSION,
      docId?.uid,
      ...(docId?.path || []),
    ],
  })
}

export function useCommentEditor(
  targetDocId: UnpackedHypermediaId,
  {
    onDiscardDraft,
    commentId,
    initCommentDraft,
    onSuccess,
    quotingBlockId,
    context,
    autoFocus,
  }: {
    initCommentDraft?: HMCommentDraft | null | undefined
    onDiscardDraft?: () => void
    commentId?: string
    onSuccess?: (commentId: {id: string}) => void
    quotingBlockId?: string
    context?: 'accessory' | 'feed' | 'document-content'
    autoFocus?: boolean
  } = {},
) {
  const selectedAccount = useSelectedAccount()
  const targetEntity = useResource(targetDocId)
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const pushComments = usePushComments()
  const openUrl = useOpenUrl()
  const [setIsSaved, isSaved] = writeableStateStream<boolean>(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>()
  const isDeletingDraft = useRef<boolean>(false)

  const selectedAccountId = useSelectedAccountId()
  const {onMentionsQuery} = useInlineMentions(selectedAccountId)
  const [submitTrigger, setSubmitTrigger] = useState(0)

  // Use a ref so the extension can access the latest setSubmitTrigger
  const setSubmitTriggerRef = useRef(setSubmitTrigger)
  setSubmitTriggerRef.current = setSubmitTrigger

  const write = trpc.comments.writeCommentDraft.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.comments.listCommentDrafts'])
      invalidateQueries([
        'trpc.comments.getCommentDraft',
        {
          targetDocId: targetDocId.id,
          replyCommentId: commentId,
          quotingBlockId: quotingBlockId,
          context: context,
        },
      ])
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const removeDraft = trpc.comments.removeCommentDraft.useMutation({
    onMutate: async () => {
      isDeletingDraft.current = true
      clearTimeout(saveTimeoutRef.current)

      await queryClient.cancelQueries([
        'trpc.comments.getCommentDraft',
        {
          targetDocId: targetDocId.id,
          replyCommentId: commentId,
          quotingBlockId: quotingBlockId,
          context: context,
        },
      ])

      queryClient.setQueryData(
        [
          'trpc.comments.getCommentDraft',
          {
            targetDocId: targetDocId.id,
            replyCommentId: commentId,
            quotingBlockId: quotingBlockId,
            context: context,
          },
        ],
        null,
      )
    },
    onSuccess: () => {
      invalidateQueries(['trpc.comments.listCommentDrafts'])
      onDiscardDraft?.()
      isDeletingDraft.current = false
    },
    onError: () => {
      isDeletingDraft.current = false
    },
  })

  async function writeDraft() {
    if (isDeletingDraft.current) return

    setIsSaved(false)
    const blocks = serverBlockNodesFromEditorBlocks(
      editor,
      // @ts-expect-error
      editor.topLevelBlocks,
    )

    // Convert to HMBlockNode format for checking
    const blockNodes = blocks.map((b) => b.toJson()) as HMBlockNode[]

    // Check if content is empty
    const hasContent = blockNodes.some(hasBlockContent)

    if (!hasContent) {
      // If content is empty and there's an existing draft, remove it
      if (initCommentDraft) {
        removeDraft.mutate({
          targetDocId: targetDocId.id,
          replyCommentId: commentId,
          quotingBlockId: quotingBlockId,
          context: context,
        })
      }
      setIsSaved(true)
      return
    }

    // Save the draft with actual content
    await write.mutateAsync({
      blocks,
      targetDocId: targetDocId.id,
      replyCommentId: commentId,
      quotingBlockId: quotingBlockId,
      context: context,
    })
    setIsSaved(true)
  }

  const gwUrl = useGatewayUrlStream()
  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      if (isDeletingDraft.current) return

      setIsSaved(false)
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        writeDraft()
      }, 500)
    },
    linkExtensionOptions: {
      // @ts-expect-error
      openOnClick: false,
      queryClient,
      grpcClient,
      openUrl,
      gwUrl,
      checkWebUrl: checkWebUrl.mutateAsync,
    },
    onEditorReady: (e) => {
      // Load draft content if it exists
      if (initCommentDraft) {
        const editorBlocks = hmBlocksToEditorContent(initCommentDraft.blocks, {
          childrenType: 'Group',
        })
        // @ts-expect-error
        e.replaceBlocks(e.topLevelBlocks, editorBlocks)
        // @ts-expect-error
        setGroupTypes(e._tiptapEditor, editorBlocks)
      }

      // Auto-focus if requested and context matches
      if (
        autoFocus &&
        (!initCommentDraft?.context || initCommentDraft.context === context)
      ) {
        setTimeout(() => {
          e._tiptapEditor.commands.focus()
        }, 100)
      }
    },
    blockSchema: getCommentEditorSchema(hmBlockSchema),
    getSlashMenuItems: () =>
      getSlashMenuItems({
        showNostr,
        docId: targetDocId,
        showQuery: false,
      }),
    onMentionsQuery,
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: 'hypermedia-link',
          addProseMirrorPlugins() {
            return [createHypermediaDocLinkPlugin({}).plugin]
          },
        }),
        Extension.create({
          name: 'comment-submit-shortcut',
          priority: 1000,
          addKeyboardShortcuts() {
            return {
              'Mod-Enter': () => {
                // Prevent the default Enter behavior
                // and trigger the submit by incrementing counter
                const setter = setSubmitTriggerRef.current
                setter((prev: number) => prev + 1)
                return true
              },
            }
          },
        }),
      ],
    },
  })

  function getCommentEditorSchema(schema: BlockSchema) {
    const commentsSchema = {
      ...schema,
    }
    delete commentsSchema.query
    return commentsSchema
  }

  useEffect(() => {
    function handleSelectAll(event: KeyboardEvent) {
      if (event.key == 'a' && event.metaKey) {
        if (editor && editor._tiptapEditor.isFocused) {
          event.preventDefault()
          editor._tiptapEditor.commands.focus()
          editor._tiptapEditor.commands.selectAll()
        }
      }
    }

    window.addEventListener('keydown', handleSelectAll)

    return () => {
      window.removeEventListener('keydown', handleSelectAll)
    }
  }, [])
  const writeRecentSigner = trpc.recentSigners.writeRecentSigner.useMutation()
  const publishComment = useMutation({
    // @ts-expect-error
    mutationFn: async ({
      content,
      signingKeyName,
    }: {
      content: BlockNode[]
      signingKeyName: string
    }) => {
      const publishContent = quotingBlockId
        ? [
            new BlockNode({
              block: {
                id: nanoid(8),
                type: 'Embed',
                text: '',
                attributes: {
                  childrenType: 'Group',
                  fields: {
                    // @ts-expect-error
                    childrenType: {case: 'stringValue', value: 'Group'},
                  },
                  view: 'Content',
                },
                annotations: [],
                link: packHmId({...targetDocId, blockRef: quotingBlockId}),
              },
              children: content,
            }),
          ]
        : content
      const resultComment = await grpcClient.comments.createComment({
        content: publishContent,
        replyParent: commentId || undefined,
        targetAccount: targetDocId.uid,
        targetPath: hmIdPathToEntityQueryPath(targetDocId.path),
        signingKeyName,
        // @ts-expect-error
        targetVersion: targetEntity.data?.document?.version!,
      })
      writeRecentSigner.mutateAsync(signingKeyName).then(() => {
        invalidateQueries(['trpc.recentSigners.get'])
      })
      if (!resultComment) throw new Error('no resultComment')
      return resultComment
    },
    onSuccess: (newComment: HMComment) => {
      setIsSubmitting(false)
      clearTimeout(saveTimeoutRef.current)

      // Clear the editor
      editor.removeBlocks(editor.topLevelBlocks)

      // Remove the draft
      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        context: context,
      })

      pushComments.mutate({
        targetDocId,
      })

      // Invalidate all relevant queries
      invalidateQueries([
        queryKeys.DOCUMENT_DISCUSSION,
        targetDocId.uid,
        ...(targetDocId.path || []),
      ])
      invalidateQueries([queryKeys.LIBRARY])
      invalidateQueries([queryKeys.SITE_LIBRARY, targetDocId.uid])
      invalidateQueries([queryKeys.LIST_ACCOUNTS])
      invalidateQueries([queryKeys.DOC_CITATIONS])

      onSuccess?.({id: newComment.id})
    },
    onError: (err: {message: string}) => {
      setIsSubmitting(false)
      toast.error(`Failed to create comment: ${err.message}`)
    },
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmitRef = useRef<(() => void) | null>(null)

  const onSubmit = () => {
    if (!targetDocId.id) throw new Error('no targetDocId.id')
    // remove trailing blocks
    // @ts-expect-error
    const editorBlocks = removeTrailingBlocks(editor.topLevelBlocks)
    const content = serverBlockNodesFromEditorBlocks(editor, editorBlocks)
    // const contentWithoutLastEmptyBlock = content.filter((block, index) => {
    //   const isLast = index === content.length - 1
    //   if (!isLast) return true
    //   if (
    //     block.type === 'paragraph' &&
    //     block.text === '' &&
    //     block.children.length === 0
    //   )
    //     return false
    //   return true
    // })
    setIsSubmitting(true)
    publishComment.mutate({
      content,
      signingKeyName: selectedAccount?.id.uid!,
    })
  }

  // Keep onSubmit ref updated so the keyboard shortcut can access it
  onSubmitRef.current = onSubmit

  // Handle submit triggered by keyboard shortcut
  useEffect(() => {
    if (submitTrigger > 0) {
      editor._tiptapEditor.commands.blur()
      onSubmitRef.current?.()
    }
  }, [submitTrigger, editor])

  return useMemo(() => {
    function onDiscard() {
      if (!targetDocId.id) throw new Error('no comment targetDocId.id')

      editor.removeBlocks(editor.topLevelBlocks)

      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        context: context,
      })
    }

    return {
      editor,
      onSubmit,
      onDiscard,
      isSaved,
      account: selectedAccount,
      isSubmitting,
    }
  }, [
    targetDocId,
    selectedAccount?.id.uid,
    onSubmit,
    isSaved,
    selectedAccount,
    isSubmitting,
  ])
}

function usePushComments() {
  const gatewayUrl = useGatewayUrlStream()
  return useMutation({
    mutationFn: async ({targetDocId}: {targetDocId: UnpackedHypermediaId}) => {
      const doc = await grpcClient.documents.getDocument({
        account: targetDocId.uid,
        path: hmIdPathToEntityQueryPath(targetDocId.path),
      })
      const rawMeta = doc.metadata?.toJson()
      const siteUrl = rawMeta
        ? HMDocumentMetadataSchema.parse(rawMeta).siteUrl
        : null
      const gwUrl = gatewayUrl.get()
      const primaryHost = siteUrl || gwUrl
      await siteDiscover({
        host: primaryHost,
        path: targetDocId.path,
        uid: targetDocId.uid,
      })
      if (gwUrl && gwUrl !== primaryHost) {
        await siteDiscover({
          host: gwUrl,
          path: targetDocId.path,
          uid: targetDocId.uid,
        })
      }
    },
  })
}

export function useDeleteComment() {
  return useMutation({
    mutationFn: async ({
      commentId,
      targetDocId,
      signingAccountId,
    }: {
      commentId: string
      targetDocId: UnpackedHypermediaId
      signingAccountId: string
    }) => {
      await grpcClient.comments.deleteComment({
        id: commentId,
        signingKeyName: signingAccountId,
      })
    },
    onSuccess: (result, variables) => {
      invalidateQueries([
        queryKeys.DOCUMENT_DISCUSSION,
        // variables.targetDocId.id,
      ])
      invalidateQueries([])
    },
  })
}
