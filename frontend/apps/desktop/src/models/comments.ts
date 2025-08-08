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
import {GRPCClient} from '@shm/shared/grpc-client'
import {
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
import {
  UseQueryOptions,
  useMutation,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import {Extension} from '@tiptap/core'
import {nanoid} from 'nanoid'
import {useEffect, useMemo, useRef} from 'react'
import {hmBlockSchema} from '../editor'
import {setGroupTypes} from './editor-utils'
import {useGatewayUrlStream} from './gateway-settings'
import {siteDiscover} from './web-links'

export function useCommentReplies(
  targetCommentId: string,
  targetDocId: UnpackedHypermediaId | undefined,
) {
  const comments = useAllDocumentComments(targetDocId)
  return useMemo(() => {
    const thread = comments.data?.filter(
      (c) => c.replyParent === targetCommentId,
    )
    return thread
  }, [comments.data, targetCommentId])
}

export function useCommentDraft(
  targetDocId: UnpackedHypermediaId,
  replyCommentId: string | undefined,
  opts?: Parameters<typeof trpc.comments.getCommentDraft.useQuery>[1],
) {
  const comment = trpc.comments.getCommentDraft.useQuery(
    {
      targetDocId: targetDocId.id,
      replyCommentId,
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

export function useComment(
  id: UnpackedHypermediaId | null | undefined,
  opts?: UseQueryOptions<HMComment | null>,
) {
  return useQuery(queryComment(grpcClient, id, opts))
}

export function useComments(commentIds: UnpackedHypermediaId[] = []) {
  return useQueries({
    queries: commentIds.map((commentId) => queryComment(grpcClient, commentId)),
  })
}

export function useAllDocumentComments(
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
      return res.comments.map((c) =>
        c.toJson({emitDefaultValues: true}),
      ) as HMComment[]
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
    replyCommentId,
    initCommentDraft,
    onSuccess,
    quotingBlockId,
  }: {
    initCommentDraft?: HMCommentDraft | null | undefined
    onDiscardDraft?: () => void
    replyCommentId?: string
    onSuccess?: (commentId: {id: string}) => void
    quotingBlockId?: string
  } = {},
) {
  const selectedAccount = useSelectedAccount()
  const targetEntity = useResource(targetDocId)
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const write = trpc.comments.writeCommentDraft.useMutation({
    onError: (err) => {
      toast.error(err.message)
    },
  })
  const removeDraft = trpc.comments.removeCommentDraft.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.comments.getCommentDraft'])
      onDiscardDraft?.()
      // Only clear editor if this was triggered by successful comment publication
      if (shouldClearEditorRef.current) {
        shouldClearEditorRef.current = false
        editor.removeBlocks(editor.topLevelBlocks)
      }
    },
  })
  const pushComments = usePushComments()
  const openUrl = useOpenUrl()
  const [setIsSaved, isSaved] = writeableStateStream<boolean>(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>()
  const readyEditor = useRef<BlockNoteEditor>()
  const shouldClearEditorRef = useRef<boolean>(false)

  const selectedAccountId = useSelectedAccountId()
  const {onMentionsQuery} = useInlineMentions(selectedAccountId)
  function initDraft() {
    if (!readyEditor.current || !initCommentDraft) return
    const editor = readyEditor.current
    const editorBlocks = hmBlocksToEditorContent(initCommentDraft.blocks, {
      childrenType: 'Group',
    })
    editor.removeBlocks(editor.topLevelBlocks)
    editor.replaceBlocks(editor.topLevelBlocks, editorBlocks)
    // @ts-expect-error
    setGroupTypes(editor._tiptapEditor, editorBlocks)
  }
  async function writeDraft() {
    setIsSaved(false)
    const blocks = serverBlockNodesFromEditorBlocks(
      editor,
      // @ts-expect-error
      editor.topLevelBlocks,
    )
    await write.mutateAsync({
      blocks,
      targetDocId: targetDocId.id,
      replyCommentId,
    })
    invalidateQueries(['trpc.comments.getCommentDraft'])
    setIsSaved(true)
  }

  const commentsSchema = {
    ...hmBlockSchema,
  }

  delete commentsSchema.query

  const gwUrl = useGatewayUrlStream()
  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      setIsSaved(false)
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        writeDraft().then(() => {
          clearTimeout(saveTimeoutRef.current)
        })
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
      readyEditor.current = e
      initDraft()
    },
    blockSchema: getCommentEditorSchema(hmBlockSchema),
    getSlashMenuItems: () =>
      getSlashMenuItems({
        showNostr,
        docId: targetDocId, // in theory this should be the comment ID but it doesn't really matter here
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
      ],
    },
  })

  function getCommentEditorSchema(schema: BlockSchema) {
    const commentsSchema = {
      ...schema,
    }

    // remove query block from schema on comments
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
        replyParent: replyCommentId || undefined,
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
      invalidateQueries([
        queryKeys.DOCUMENT_DISCUSSION,
        targetDocId.uid,
        ...(targetDocId.path || []),
      ])
      invalidateQueries([queryKeys.LIBRARY])
      invalidateQueries([queryKeys.SITE_LIBRARY, targetDocId.uid])
      invalidateQueries([queryKeys.LIST_ACCOUNTS])
      invalidateQueries([queryKeys.FEED_LATEST_EVENT])
      invalidateQueries([queryKeys.RESOURCE_FEED_LATEST_EVENT])
      invalidateQueries([queryKeys.DOC_CITATIONS])
      clearTimeout(saveTimeoutRef.current)
      // Set flag to indicate we should clear editor after draft removal
      shouldClearEditorRef.current = true
      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId,
      })
      pushComments.mutate({
        targetDocId,
      })
      onSuccess?.({id: newComment.id})
    },
    onError: (err: {message: string}) => {
      toast.error(`Failed to create comment: ${err.message}`)
    },
  })
  return useMemo(() => {
    function onSubmit() {
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
      publishComment.mutate({
        content,
        signingKeyName: selectedAccount?.id.uid!,
      })
    }
    function onDiscard() {
      if (!targetDocId.id) throw new Error('no comment targetDocId.id')
      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId,
      })
    }

    return {
      editor,
      onSubmit,
      onDiscard,
      isSaved,
      account: selectedAccount,
    }
  }, [targetDocId, selectedAccount?.id.uid])
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
