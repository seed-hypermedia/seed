import {useAppContext} from '@/app-context'
import {EditorBlock, createHypermediaDocLinkPlugin} from '@/editor'
import {useOpenUrl} from '@/open-url'
import {slashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  BIG_INT,
  BlockNode,
  GRPCClient,
  HMBlockNode,
  HMComment,
  HMCommentDraft,
  HMCommentDraftSchema,
  HMCommentGroup,
  HMEntityContent,
  UnpackedHypermediaId,
  editorBlockToHMBlock,
  getCommentGroups,
  hmBlocksToEditorContent,
  hmIdPathToEntityQueryPath,
  invalidateQueries,
  queryKeys,
  writeableStateStream,
} from '@shm/shared'
import {toast} from '@shm/ui'
import {
  UseQueryOptions,
  useMutation,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import {Extension} from '@tiptap/core'
import {useEffect, useMemo, useRef} from 'react'
import {useGRPCClient} from '../app-context'
import {hmBlockSchema, useBlockNote} from '../editor'
import type {BlockNoteEditor} from '../editor/blocknote'
import {getBlockGroup, setGroupTypes} from './editor-utils'
import {useEntity} from './entities'
import {useGatewayUrlStream} from './gateway-settings'
import {useInlineMentions} from './search'

function serverBlockNodesFromEditorBlocks(
  editor: BlockNoteEditor,
  editorBlocks: EditorBlock[],
): BlockNode[] {
  if (!editorBlocks) return []
  return editorBlocks.map((block: EditorBlock) => {
    const childGroup = getBlockGroup(editor, block.id) || {}
    const serverBlock = editorBlockToHMBlock(block)
    if (childGroup) {
      if (!serverBlock.attributes) {
        serverBlock.attributes = {}
      }
      serverBlock.attributes.childrenType = childGroup.type
        ? childGroup.type
        : 'Group'
      if (childGroup.listLevel)
        serverBlock.attributes.listLevel = childGroup.listLevel
      if (childGroup.start)
        serverBlock.attributes.start = childGroup.start.toString()
    }
    return new BlockNode({
      block: serverBlock,
      children: serverBlockNodesFromEditorBlocks(editor, block.children),
    })
  })
}

export function useCommentGroups(
  comments: HMComment[] | undefined,
  targetCommentId: string | null,
): HMCommentGroup[] {
  return useMemo(() => {
    return getCommentGroups(comments, targetCommentId)
  }, [comments, targetCommentId])
}

export function useCommentReplies(
  targetCommentId: string,
  targetDocId: UnpackedHypermediaId,
) {
  const comments = useAllDocumentComments(targetDocId)
  return useMemo(() => {
    let comment = comments.data?.find((c) => c.id === targetCommentId)
    const thread = [comment]
    while (comment) {
      comment = comments.data?.find((c) => c.id === comment?.replyParent)
      thread.unshift(comment)
    }
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
  commentId: string | undefined,
  opts?: UseQueryOptions<HMComment | null>,
) {
  return {
    // ...opts,
    queryKey: [queryKeys.COMMENT, commentId],
    enabled: opts?.enabled !== false && !!commentId,
    queryFn: async () => {
      if (!commentId) return null
      const comment = await grpcClient.comments.getComment({
        id: commentId,
      })
      return toPlainMessage(comment) as HMComment
    },
  }
}

export function useComment(
  id: UnpackedHypermediaId | null | undefined,
  opts?: UseQueryOptions<HMComment | null>,
) {
  const grpcClient = useGRPCClient()
  return useQuery(queryComment(grpcClient, id?.id, opts))
}

export function useComments(commentIds: string[] = []) {
  const grpcClient = useGRPCClient()
  return useQueries({
    queries: commentIds.map((commentId) => queryComment(grpcClient, commentId)),
  })
}

export function useAllDocumentComments(
  docId: UnpackedHypermediaId | undefined,
) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryFn: async () => {
      if (!docId) return []
      let res = await grpcClient.comments.listComments({
        targetAccount: docId.uid,
        targetPath: hmIdPathToEntityQueryPath(docId.path),
        pageSize: BIG_INT,
      })
      return res.comments.map(toPlainMessage) as HMComment[]
    },
    enabled: !!docId,
    refetchInterval: 10_000,
    queryKey: [queryKeys.DOCUMENT_COMMENTS, docId?.uid, ...(docId?.path || [])],
  })
}

export function useDocumentCommentGroups(
  docId: UnpackedHypermediaId | undefined,
  commentId: string | null = null,
) {
  const comments = useAllDocumentComments(docId)
  return useCommentGroups(comments.data, commentId)
}

export function useCommentEditor(
  targetDocId: UnpackedHypermediaId,
  accounts: HMEntityContent[],
  {
    onDiscardDraft,
    replyCommentId,
    initCommentDraft,
  }: {
    initCommentDraft?: HMCommentDraft | null | undefined
    onDiscardDraft?: () => void
    replyCommentId?: string
  } = {},
) {
  const targetEntity = useEntity(targetDocId)
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const queryClient = useAppContext().queryClient
  const write = trpc.comments.writeCommentDraft.useMutation({
    onError: (err) => {
      toast.error(err.message)
    },
  })
  const removeDraft = trpc.comments.removeCommentDraft.useMutation({
    onSuccess: () => {
      invalidateQueries(['trpc.comments.getCommentDraft'])
      onDiscardDraft?.()
    },
  })
  const openUrl = useOpenUrl()
  const [setIsSaved, isSaved] = writeableStateStream<boolean>(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>()
  const readyEditor = useRef<BlockNoteEditor>()
  const grpcClient = useGRPCClient()
  const {inlineMentionsData, inlineMentionsQuery} = useInlineMentions()
  function initDraft() {
    if (!readyEditor.current || !initCommentDraft) return
    const editor = readyEditor.current
    const editorBlocks = hmBlocksToEditorContent(initCommentDraft.blocks, {
      childrenType: 'Group',
    })
    editor.removeBlocks(editor.topLevelBlocks)
    editor.replaceBlocks(editor.topLevelBlocks, editorBlocks)
    setGroupTypes(editor._tiptapEditor, editorBlocks)
  }
  async function writeDraft() {
    const signerUid = account.get()
    if (!signerUid) {
      console.warn('trying to write draft without account')
      return
    }
    setIsSaved(false)
    const blocks = serverBlockNodesFromEditorBlocks(
      editor,
      editor.topLevelBlocks,
    )
    await write.mutateAsync({
      blocks,
      targetDocId: targetDocId.id,
      replyCommentId,
      account: signerUid,
    })
    invalidateQueries(['trpc.comments.getCommentDraft'])
    setIsSaved(true)
  }
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
    blockSchema: hmBlockSchema,
    slashMenuItems: !showNostr
      ? slashMenuItems.filter((item) => item.name != 'Nostr')
      : slashMenuItems,
    onMentionsQuery: (query: string) => {
      inlineMentionsQuery(query)
    },
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

  useEffect(() => {
    if (inlineMentionsData) {
      editor?.setInlineEmbedOptions(inlineMentionsData)
    }
  }, [inlineMentionsData])

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

  // const draftQuery = trpc.comments.getCommentDraft.useQuery(
  //   {
  //     targetDocId: targetDocId.id,
  //     replyCommentId,
  //   },
  //   {
  //     onError: (err) =>
  //       appError(`Could not load comment draft: ${err.message}`),
  //     onSuccess: (draft: HMCommentDraft | null) => {
  //       if (initCommentDraft.current) return
  //       if (draft) {
  //         initCommentDraft.current = draft
  //         setAccountStream(draft.account)
  //       } else {
  //         const account: string = accounts[0]!.id.uid
  //         initCommentDraft.current = {
  //           account,
  //           blocks: [],
  //         }
  //         setAccountStream(account)
  //       }
  //       initDraft()
  //     },
  //   },
  // )
  // const initCommentDraft = useRef<HMCommentDraft | null | undefined>(
  //   draftQuery.data,
  // )
  const recentSigners = trpc.recentSigners.get.useQuery()
  console.log('recentSigners', recentSigners.data)
  const availableRecentSigner = recentSigners.data
    ? recentSigners.data.recentSigners.find((signer) =>
        accounts.find((a) => a.id.uid === signer),
      ) || accounts[0]?.id.uid
    : null
  const accountRef = useRef(
    writeableStateStream<string | null>(
      initCommentDraft?.account || availableRecentSigner || null,
    ),
  )
  const [setAccountStream, account] = accountRef.current
  if (availableRecentSigner && !account.get()) {
    setAccountStream(availableRecentSigner)
  }
  const writeRecentSigner = trpc.recentSigners.writeRecentSigner.useMutation()
  const publishComment = useMutation({
    mutationFn: async ({
      content,
      signingKeyName,
    }: {
      content: HMBlockNode[]
      signingKeyName: string
    }) => {
      const resultComment = await grpcClient.comments.createComment({
        content,
        replyParent: replyCommentId || undefined,
        targetAccount: targetDocId.uid,
        targetPath: hmIdPathToEntityQueryPath(targetDocId.path),
        signingKeyName,
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
        queryKeys.DOCUMENT_COMMENTS,
        targetDocId.uid,
        ...(targetDocId.path || []),
      ])
      invalidateQueries([queryKeys.SITE_LIBRARY, targetDocId.uid])
      invalidateQueries([queryKeys.LIST_ACCOUNTS])
      invalidateQueries([queryKeys.FEED_LATEST_EVENT])
      invalidateQueries([queryKeys.RESOURCE_FEED_LATEST_EVENT])
      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId,
      })
    },
  })
  return useMemo(() => {
    function onSubmit() {
      if (!targetDocId.id) throw new Error('no targetDocId.id')
      const content = serverBlockNodesFromEditorBlocks(
        editor,
        editor.topLevelBlocks,
      )
      const contentWithoutLastEmptyBlock = content.filter((block, index) => {
        const isLast = index === content.length - 1
        if (!isLast) return true
        if (
          block.type === 'paragraph' &&
          block.text === '' &&
          block.children.length === 0
        )
          return false
        return true
      })
      publishComment.mutate({
        content: contentWithoutLastEmptyBlock,
        signingKeyName: account.get()!,
      })
    }
    function onDiscard() {
      if (!targetDocId.id) throw new Error('no comment targetDocId.id')
      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId,
      })
    }

    function onSetAccount(accountId: string) {
      setAccountStream(accountId)
      writeDraft()
    }
    return {
      editor,
      onSubmit,
      onDiscard,
      isSaved,
      account,
      onSetAccount,
    }
  }, [targetDocId])
}
