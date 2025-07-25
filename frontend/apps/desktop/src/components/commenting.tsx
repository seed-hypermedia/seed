import {useCommentDraft, useCommentEditor} from '@/models/comments'
import {useContacts, useSelectedAccountContacts} from '@/models/contacts'
import {useSubscribedResource} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  HMAccountsMetadata,
  HMBlockEmbed,
  HMComment,
  HMCommentDraft,
  HMCommentGroup,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {StateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {
  BlocksContent,
  getBlockNodeById,
  useDocContentContext,
} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {useStream} from '@shm/ui/use-stream'
import {memo, MouseEvent, useEffect, useMemo, useState} from 'react'
import {useSizeObserver} from './app-embeds'
import {HyperMediaEditorView} from './editor'

export function renderCommentContent(comment: HMComment) {
  const data: HMComment & {reference: string | null} = useMemo(() => {
    if (comment.content.length === 1) {
      let parentBlock = comment.content[0]
      if (parentBlock.block.type === 'Embed') {
        return {
          ...comment,
          reference: (parentBlock.block as HMBlockEmbed).link,
          content: parentBlock.children || [],
        }
      }
    }

    return {
      ...comment,
      reference: null,
    }
  }, [comment])

  return (
    <AppDocContentProvider
      comment

      // onBlockReply={onBlockReply}
      // onBlockReply={() => {}}
      // onBlockCopy={(
      //   blockId: string,
      //   blockRange: BlockRange | ExpandedBlockRange | undefined,
      // ) => {
      //   const url = `hm://c/${comment.id}#${blockId}${serializeBlockRange(
      //     blockRange,
      //   )}`
      //   copyUrlToClipboardWithFeedback(url, 'Comment Block')
      // }}
    >
      <div className="flex w-full flex-col">
        <CommentReference reference={data.reference} />
        <BlocksContent blocks={data.content} parentBlockId={null} />
      </div>
    </AppDocContentProvider>
  )
}

export function useCommentGroupAuthors(
  commentGroups: HMCommentGroup[],
): HMAccountsMetadata {
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
      .map((uid, index) => [uid, authorEntities[index].data])
      .filter(([k, v]) => !!v),
  )
}

export const CommentBox = memo(_CommentBox)
function _CommentBox({
  docId,
  backgroundColor = 'transparent',
  quotingBlockId,
  replyCommentId,
  autoFocus,
}: {
  docId: UnpackedHypermediaId
  backgroundColor?: string
  quotingBlockId?: string
  replyCommentId?: string
  autoFocus?: boolean
}) {
  const draft = useCommentDraft(docId, undefined)
  const route = useNavRoute()
  const replace = useNavigate('replace')
  let content = null
  let onPress = undefined
  const [isStartingComment, setIsStartingComment] = useState(false)
  // useEffect(() => {
  //   triggerCommentDraftFocus(docId.id, replyCommentId)
  // })

  function focusEditor() {
    setIsStartingComment(true)
  }

  useEffect(() => {
    const focusKey = `${docId.id}-${replyCommentId || quotingBlockId}`
    const subscribers = focusSubscribers.get(focusKey)
    if (subscribers) {
      subscribers.add(focusEditor)
    } else {
      focusSubscribers.set(focusKey, new Set([focusEditor]))
    }
  }, [docId.id, replyCommentId])

  if (draft.isInitialLoading) return null
  if (draft.data || isStartingComment) {
    content = (
      <CommentDraftEditor
        docId={docId}
        autoFocus={isStartingComment}
        initCommentDraft={draft.data}
        quotingBlockId={quotingBlockId}
        replyCommentId={replyCommentId}
        onDiscardDraft={() => {
          setIsStartingComment(false)
        }}
        onSuccess={({id}) => {
          if (route.key === 'document' && !!id) {
            const accessory = route.accessory
            const discussionsAccessory =
              accessory?.key === 'discussions' ? accessory : null
            replace({
              ...route,
              id: {
                ...route.id,
              },
              accessory: discussionsAccessory
                ? {
                    ...discussionsAccessory,
                    openComment: id,
                  }
                : undefined,
            })
          }
        }}
      />
    )
  } else {
    content = (
      <Button
        variant="ghost"
        className="text-muted-foreground m-0 h-auto flex-1 items-start justify-start border-0 px-[18px] py-4 text-left text-base hover:bg-transparent focus:bg-transparent"
        style={{backgroundColor: backgroundColor}}
        onClick={() => {
          setIsStartingComment(true)
        }}
      >
        <span className="text-sm font-thin italic">
          {replyCommentId ? 'Reply in Discussion' : 'Start a new Discussion'}
        </span>
      </Button>
    )
  }
  return (
    <div className="rounded-lg" onClick={onPress}>
      {content}
    </div>
  )
}

export function triggerCommentDraftFocus(
  docId: string,
  replyCommentId?: string,
) {
  const focusKey = `${docId}-${replyCommentId}`
  const subscribers = focusSubscribers.get(focusKey)
  if (subscribers) {
    subscribers.forEach((fn) => fn())
  }
}

const focusSubscribers = new Map<string, Set<() => void>>()

const CommentDraftEditor = memo(_CommentDraftEditor)
function _CommentDraftEditor({
  docId,
  onDiscardDraft,
  autoFocus,
  replyCommentId,
  initCommentDraft,
  onSuccess,
  quotingBlockId,
}: {
  docId: UnpackedHypermediaId
  onDiscardDraft?: () => void
  autoFocus?: boolean
  replyCommentId?: string
  initCommentDraft?: HMCommentDraft | null | undefined
  onSuccess?: (commentId: {id: string}) => void
  quotingBlockId?: string
}) {
  const [isHorizontal, setIsHorizontal] = useState(false)
  const sizeObserverdRef = useSizeObserver((rect) => {
    setIsHorizontal(rect.width > 322)
  })

  const {editor, onSubmit, onDiscard, isSaved, account} = useCommentEditor(
    docId,
    {
      onDiscardDraft,
      replyCommentId,
      initCommentDraft,
      onSuccess,
      quotingBlockId,
    },
  )
  const openUrl = useOpenUrl()
  useEffect(() => {
    if (autoFocus) {
      editor._tiptapEditor.commands.focus()
    }
  }, [
    autoFocus,
    editor,
    // include this because if autoFocus is true when the reply commentID or docId changes, we should focus again
    docId.id,
    replyCommentId,
  ])
  const contacts = useSelectedAccountContacts()

  if (!account) return null

  return (
    <div
      ref={sizeObserverdRef}
      className="comment-editor mt-1 flex flex-1 flex-col px-4"
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement

        // Check if the clicked element is not an input, button, or textarea
        if (target.closest('input, textarea, select, button')) {
          return // Don't focus the editor in this case
        }
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
      onKeyDownCapture={(e: React.KeyboardEvent<HTMLDivElement>) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          editor._tiptapEditor.commands.blur()
          onSubmit()
          return true
        }
      }}
    >
      <div className="flex-1">
        <AppDocContentProvider comment contacts={contacts.data || undefined}>
          <HyperMediaEditorView editor={editor} openUrl={openUrl} comment />
        </AppDocContentProvider>
      </div>
      <div
        className={`w-full max-w-[320px] flex-1 gap-2 self-end ${
          isHorizontal ? 'flex-row items-center' : 'flex-col'
        } flex`}
      >
        <div className="flex flex-1 items-center">
          <AutosaveIndicator isSaved={isSaved} />
        </div>
        <div className="flex items-center gap-2">
          <Tooltip
            content={`Publish Comment as "${account?.document?.metadata.name}"`}
          >
            <Button
              className="w-full flex-1"
              size="sm"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation()
                onSubmit()
              }}
              disabled={!isSaved.get()}
            >
              {account ? (
                <HMIcon
                  id={account.id}
                  metadata={account.document?.metadata}
                  size={16}
                />
              ) : null}
              Publish
            </Button>
          </Tooltip>
          <Tooltip content="Discard Comment Draft">
            <Button
              size="icon"
              className="size-7"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation()
                onDiscard()
              }}
              variant="destructive"
            >
              <Trash className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

const autosaveIndicatorSize = 6
function AutosaveIndicator({isSaved}: {isSaved: StateStream<boolean>}) {
  const currentIsSaved = useStream(isSaved)
  return (
    <div
      className="absolute top-0 left-0 h-1.5 w-1.5 -translate-x-3 translate-y-2.5 rounded-full"
      style={{
        backgroundColor: currentIsSaved ? 'transparent' : '#eab308',
      }}
    />
  )
}

function CommentReference({reference}: {reference: string | null}) {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  const context = useDocContentContext()
  const referenceId = useMemo(() => {
    if (!reference) return null
    return unpackHmId(reference)
  }, [reference])

  const referenceData = useSubscribedResource(referenceId)

  const referenceContent = useMemo(() => {
    const content =
      referenceData.data?.type === 'document'
        ? referenceData.data.document?.content
        : undefined
    if (!referenceData.data) return null
    if (referenceId?.blockRef) {
      let bn = getBlockNodeById(content || [], referenceId.blockRef)
      if (bn) {
        return [bn]
      } else {
        return content || []
      }
    }

    return content || []
  }, [referenceData.data])

  const highlight = useMemo(() => {
    if (!referenceId) return false
    if (route.key !== 'document') return false
    if (!route.id) return false
    if (!referenceId.blockRef) return false
    return referenceId.blockRef == route.id.blockRef
  }, [route, referenceId])

  if (!referenceData.data) return null

  return (
    <div
      className={`border-l-primary m-2 ml-0.5 flex w-full cursor-pointer items-center gap-3 border-l-2 ${
        highlight ? 'bg-primary text-primary-foreground' : 'bg-transparent'
      }`}
      onMouseEnter={() => {
        if (referenceId) {
          context.onHoverIn?.(referenceId)
        }
      }}
      onMouseLeave={() => {
        if (referenceId) {
          context.onHoverOut?.(referenceId)
        }
      }}
      onClick={() => {
        if (route.key == 'document' && referenceId?.blockRef) {
          navigate({
            ...route,
            isBlockFocused: false,
            id: {
              ...route.id,
              blockRef: referenceId.blockRef,
              blockRange:
                referenceId.blockRange &&
                'start' in referenceId.blockRange &&
                'end' in referenceId.blockRange
                  ? referenceId.blockRange
                  : null,
            },
          })
        }
      }}
    >
      <div className="flex-1 opacity-50">
        <AppDocContentProvider {...context} comment>
          <BlocksContent
            blocks={referenceContent}
            parentBlockId={null}
            expanded={false}
            hideCollapseButtons
          />
        </AppDocContentProvider>
      </div>
    </div>
  )
}
