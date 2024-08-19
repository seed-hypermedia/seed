import {useAppContext} from '@/app-context'
import {createHypermediaDocLinkPlugin} from '@/editor'
import {useOpenUrl} from '@/open-url'
import {slashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  BlockNode,
  HMBlockNode,
  HMComment,
  HMCommentDraft,
  HMCommentGroup,
  HMEntityContent,
  UnpackedHypermediaId,
  fromHMBlock,
  toHMBlock,
  writeableStateStream,
} from '@shm/shared'
import {toast} from '@shm/ui'
import {UseQueryOptions, useMutation, useQuery} from '@tanstack/react-query'
import {Extension} from '@tiptap/core'
import {useEffect, useMemo, useRef} from 'react'
import {useGRPCClient, useQueryInvalidator} from '../app-context'
import {hmBlockSchema, useBlockNote} from '../editor'
import type {Block, BlockNoteEditor} from '../editor/blocknote'
import appError from '../errors'
import {getBlockGroup, setGroupTypes} from './editor-utils'
import {hmIdPathToEntityQueryPath, useEntity} from './entities'
import {useGatewayUrlStream} from './gateway-settings'
import {queryKeys} from './query-keys'
import {useInlineMentions} from './search'

function serverBlockNodesFromEditorBlocks(
  editor: BlockNoteEditor,
  editorBlocks: Block[],
): BlockNode[] {
  if (!editorBlocks) return []
  return editorBlocks.map((block: Block) => {
    const childGroup = getBlockGroup(editor, block.id) || {}
    const serverBlock = fromHMBlock(block)
    if (childGroup) {
      serverBlock.attributes.childrenType = childGroup.type
        ? childGroup.type
        : 'group'
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
    const groups: HMCommentGroup[] = []
    comments?.forEach((comment) => {
      if (
        comment.replyParent === targetCommentId ||
        (!targetCommentId && comment.replyParent === '')
      ) {
        groups.push({
          comments: [comment],
          moreCommentsCount: 0,
          id: comment.id,
        })
      }
    })
    groups.forEach((group) => {
      let comment: HMComment | null = group.comments[0]
      while (comment) {
        const nextComments = comments?.filter(
          (c) => c.replyParent === comment?.id,
        )
        if (nextComments?.length === 1) {
          comment = nextComments[0]
          group.comments.push(comment)
        } else {
          comment = null
        }
      }
      const lastGroupComment = group.comments.at(-1)
      if (!lastGroupComment || !comments) return
      const moreComments = new Set<string>()
      let walkMoreCommentIds = new Set<string>([lastGroupComment.id])
      while (walkMoreCommentIds.size) {
        walkMoreCommentIds.forEach((commentId) => moreComments.add(commentId))
        walkMoreCommentIds = new Set<string>(
          comments
            .filter(
              (c) => c.replyParent && walkMoreCommentIds.has(c.replyParent),
            )
            .map((comment) => comment.id),
        )
      }
      group.moreCommentsCount = moreComments.size - 1
    })
    return groups
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
  return comment
}

export function useComment(
  id: UnpackedHypermediaId | null | undefined,
  opts?: UseQueryOptions<HMComment | null>,
) {
  const grpcClient = useGRPCClient()
  return useQuery({
    ...opts,
    queryKey: [queryKeys.COMMENT, id?.id],
    enabled: opts?.enabled !== false && !!id?.id,
    queryFn: async () => {
      if (!id?.id) return null
      const comment = await grpcClient.comments.getComment({
        id: id.id,
      })
      return toPlainMessage(comment)
    },
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
      })
      return res.comments.map(toPlainMessage) as HMComment[]
    },
    enabled: !!docId,
    refetchInterval: 10_000,
    queryKey: [queryKeys.DOCUMENT_COMMENTS, docId?.id],
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
  }: {onDiscardDraft?: () => void; replyCommentId?: string} = {},
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
  const invalidate = useQueryInvalidator()
  const removeDraft = trpc.comments.removeCommentDraft.useMutation({
    onSuccess: () => {
      invalidate(['trpc.comments.getCommentDraft'])
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
    const draft = initCommentDraft.current
    if (!readyEditor.current || !draft) return
    const editor = readyEditor.current
    const editorBlocks = toHMBlock(draft.blocks)
    editor.removeBlocks(editor.topLevelBlocks)
    editor.replaceBlocks(editor.topLevelBlocks, editorBlocks)
    setGroupTypes(editor._tiptapEditor, editorBlocks)
  }
  async function writeDraft() {
    setIsSaved(false)
    const blocks = serverBlockNodesFromEditorBlocks(
      editor,
      editor.topLevelBlocks,
    )
    console.log('blocks', blocks)
    console.log('targetDocId.id', targetDocId.id)
    console.log('account.get()!', account.get()!)
    await write.mutateAsync({
      blocks,
      targetDocId: targetDocId.id,
      replyCommentId,
      account: account.get()!,
    })
    invalidate(['trpc.comments.getCommentDraft'])
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
      checkWebUrl: checkWebUrl.mutate,
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
            return [
              createHypermediaDocLinkPlugin({
                queryClient,
              }).plugin,
            ]
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

  const draftQuery = trpc.comments.getCommentDraft.useQuery(
    {
      targetDocId: targetDocId.id,
      replyCommentId,
    },
    {
      onError: (err) =>
        appError(`Could not load comment draft: ${err.message}`),
      onSuccess: (draft: HMCommentDraft | null) => {
        if (initCommentDraft.current) return
        if (draft) {
          initCommentDraft.current = draft
          setAccountStream(draft.account)
        } else {
          const account: string = accounts[0]!.id.uid
          initCommentDraft.current = {
            account,
            blocks: [],
          }
          setAccountStream(account)
        }
        initDraft()
      },
    },
  )
  const initCommentDraft = useRef<HMCommentDraft | null | undefined>(
    draftQuery.data,
  )
  const accountRef = useRef(
    writeableStateStream<string | null>(
      draftQuery.data?.account || accounts[0]?.id.uid || null,
    ),
  )
  const [setAccountStream, account] = accountRef.current

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
      if (!resultComment) throw new Error('no resultComment')
      return resultComment
    },
    onSuccess: (newComment: HMComment) => {
      removeDraft.mutate({
        targetDocId: targetDocId.id,
        replyCommentId,
      })
      invalidate([
        queryKeys.DOCUMENT_COMMENTS,
        targetDocId.uid,
        ...(targetDocId.path || []),
      ])
      invalidate([queryKeys.FEED_LATEST_EVENT])
      invalidate([queryKeys.RESOURCE_FEED_LATEST_EVENT])
    },
  })
  return useMemo(() => {
    function onSubmit() {
      if (!targetDocId.id) throw new Error('no targetDocId.id')
      const draft = initCommentDraft.current
      if (!draft) throw new Error('no draft found to publish')
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
