import {useAppContext} from '@/app-context'
import {createHypermediaDocLinkPlugin} from '@/editor'
import {useOpenUrl} from '@/open-url'
import {slashMenuItems} from '@/slash-menu-items'
import {trpc} from '@/trpc'
import {
  HMBlockNode,
  HMComment,
  HMCommentDraft,
  HMEntityContent,
  UnpackedHypermediaId,
  fromHMBlock,
  hmId,
  packHmId,
  toHMBlock,
  unpackHmId,
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
import {useNavigate} from '../utils/useNavigate'
import {getBlockGroup, setGroupTypes} from './editor-utils'
import {useGatewayUrlStream} from './gateway-settings'
import {queryKeys} from './query-keys'
import {useInlineMentions} from './search'

function serverBlockNodesFromEditorBlocks(
  editor: BlockNoteEditor,
  editorBlocks: Block[],
): HMBlockNode[] {
  if (!editorBlocks) return []
  return editorBlocks.map((block: Block) => {
    const childGroup = getBlockGroup(editor, block.id) || {}
    const serverBlock = fromHMBlock(block)
    if (childGroup) {
      // @ts-expect-error
      serverBlock.attributes.childrenType = childGroup.type
        ? childGroup.type
        : 'group'
      // @ts-expect-error
      serverBlock.attributes.listLevel = childGroup.listLevel
      // @ts-expect-error
      if (childGroup.start)
        serverBlock.attributes.start = childGroup.start.toString()
    }
    return {
      block: serverBlock,
      children: serverBlockNodesFromEditorBlocks(editor, block.children),
    }
  })
}

export type CommentGroup = {
  comments: HMComment[]
  moreCommentsCount: number
  id: string
}

export function useCommentGroups(
  comments: HMComment[] | undefined,
  targetCommentId: string | null,
): CommentGroup[] {
  return useMemo(() => {
    const groups: CommentGroup[] = []
    comments?.forEach((comment) => {
      if (
        comment.repliedComment === targetCommentId ||
        (!targetCommentId && comment.repliedComment === '')
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
          (c) => c.repliedComment === comment?.id,
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
              (c) =>
                c.repliedComment && walkMoreCommentIds.has(c.repliedComment),
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
  targetDocUid: string,
) {
  const comments = useAllDocumentComments(targetDocUid)
  return useMemo(() => {
    let comment = comments.data?.find((c) => c.id === targetCommentId)
    const thread = [comment]
    while (comment) {
      comment = comments.data?.find((c) => c.id === comment?.repliedComment)
      thread.unshift(comment)
    }
    return thread
  }, [comments.data, targetCommentId])
}

export function useComment(
  id: UnpackedHypermediaId | null | undefined,
  opts?: UseQueryOptions<HMComment>,
) {
  const grpcClient = useGRPCClient()
  return useQuery({
    ...opts,
    enabled: opts?.enabled !== false && !!id?.id,
    queryFn: async () => {
      if (!id?.id) return null
      let res = await grpcClient.comments.getComment({
        id: id.id,
      })
      const comment = res as unknown as HMComment
      return comment
    },
    queryKey: [queryKeys.COMMENT, id?.id],
  })
}

export function useAllDocumentComments(docUid: string | undefined) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryFn: async () => {
      if (!docUid) return []
      let res = await grpcClient.comments.listComments({
        target: packHmId(hmId('d', docUid)),
      })
      return res.comments as unknown as HMComment[]
    },
    enabled: !!docUid,
    refetchInterval: 10_000,
    queryKey: [queryKeys.PUBLICATION_COMMENTS, docUid],
  })
}

export function useDocumentCommentGroups(
  docUid: string | undefined,
  commentId: string | null = null,
) {
  const comments = useAllDocumentComments(docUid)
  return useCommentGroups(comments.data, commentId)
}

export function useCommentEditor(
  targetDocId: UnpackedHypermediaId,
  accounts: HMEntityContent[],
) {
  const checkWebUrl = trpc.webImporting.checkWebUrl.useMutation()
  const showNostr = trpc.experiments.get.useQuery().data?.nostr
  const queryClient = useAppContext().queryClient
  const write = trpc.comments.writeCommentDraft.useMutation({
    onError: (err) => {
      toast.error(err.message)
    },
  })
  const removeDraft = trpc.comments.removeCommentDraft.useMutation({})
  const openUrl = useOpenUrl()
  const [setIsSaved, isSaved] = writeableStateStream<boolean>(true)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>()
  const readyEditor = useRef<BlockNoteEditor>()
  const grpcClient = useGRPCClient()
  const replace = useNavigate('replace')
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
    await write.mutateAsync({
      blocks,
      targetDocId: targetDocId.id,
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

  const draftQuery = trpc.comments.getCommentDraft.useQuery(
    {
      targetDocId: targetDocId.id,
    },
    {
      onError: (err) =>
        appError(`Could not load comment draft: ${err.message}`),
      onSuccess: (draft) => {
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
    writeableStateStream<string | null>(draftQuery.data?.account || null),
  )
  const [setAccountStream, account] = accountRef.current

  const invalidate = useQueryInvalidator()
  const publishComment = useMutation({
    mutationFn: async ({
      content,
      targetDocId,
    }: {
      content: HMBlockNode[]
      targetDocId: string
    }) => {
      throw new Error('No Comment API yet')
      // const resultComment = await grpcClient.comments.createComment({
      //   content,
      //   target: targetDocId,
      //   repliedComment: targetCommentId || undefined,
      // })
      // if (!resultComment) throw new Error('no resultComment')
      // return resultComment
    },
    onSuccess: (newComment: HMComment) => {
      const targetDocId = newComment.target
        ? unpackHmId(newComment.target)
        : null
      targetDocId &&
        invalidate([queryKeys.PUBLICATION_COMMENTS, targetDocId.uid])
      invalidate(['trpc.comments.getCommentDrafts'])
      invalidate([queryKeys.FEED_LATEST_EVENT])
      invalidate([queryKeys.RESOURCE_FEED_LATEST_EVENT])
      replace({
        key: 'comment',
        showThread: true,
        commentId: newComment.id,
      })
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
      toast.error('Publishing comments is not yet supported by the API')
      publishComment.mutate({
        content: contentWithoutLastEmptyBlock,
        targetDocId: targetDocId.id,
      })
    }
    function onDiscard() {
      if (!targetDocId.id) throw new Error('no comment targetDocId.id')
      removeDraft
        .mutateAsync({
          targetDocId: targetDocId.id,
        })
        .then(() => {})
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
  }, [targetDocId.id])
}
