import {useCommentDraft, useCommentEditor} from '@/models/comments'
import {useContacts, useSelectedAccountContacts} from '@/models/contacts'
import {useSubscribedResource} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {queryClient, queryKeys} from '@shm/shared'
import {useNavRoute} from '@shm/shared/utils/navigation'

import {
  HMBlockEmbed,
  HMComment,
  HMCommentDraft,
  HMCommentGroup,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {ListDiscussionsResponse} from '@shm/shared/models/comments-service'
import {useStream} from '@shm/shared/use-stream'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {StateStream} from '@shm/shared/utils/stream'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {
  BlocksContent,
  getBlockNodeById,
  useDocContentContext,
} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {SendHorizonal} from 'lucide-react'
import {memo, MouseEvent, useEffect, useMemo, useState} from 'react'
import {useSizeObserver} from './app-embeds'
import {HyperMediaEditorView} from './editor'

export function renderCommentContent(comment: HMComment) {
  const data: HMComment & {reference: string | null} = useMemo(() => {
    if (comment.content.length === 1) {
      let parentBlock = comment.content[0]
      // @ts-ignore
      if (parentBlock.block.type === 'Embed') {
        return {
          ...comment,
          // @ts-ignore
          reference: (parentBlock.block as HMBlockEmbed).link,
          // @ts-ignore
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
    <AppDocContentProvider comment>
      <div className="flex w-full flex-col">
        <CommentReference reference={data.reference} />
        <BlocksContent blocks={data.content} parentBlockId={null} />
      </div>
    </AppDocContentProvider>
  )
}

export function useCommentGroupAuthors(
  commentGroups: HMCommentGroup[],
): ListDiscussionsResponse['authors'] {
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
}) {
  const {
    docId,
    backgroundColor = 'transparent',
    quotingBlockId,
    commentId,
    autoFocus,
  } = props

  const account = useSelectedAccount()
  const draft = useCommentDraft(
    quotingBlockId ? {...docId, blockRef: quotingBlockId} : docId,
    commentId,
  )
  const [isStartingComment, setIsStartingComment] = useState(false)
  function focusEditor() {
    setIsStartingComment(true)
  }

  useEffect(() => {
    const focusKey = `${docId.id}-${commentId || quotingBlockId}`
    const subscribers = focusSubscribers.get(focusKey)
    if (subscribers) {
      subscribers.add(focusEditor)
    } else {
      focusSubscribers.set(focusKey, new Set([focusEditor]))
    }
  }, [docId.id, commentId])

  if (draft.isInitialLoading) return null

  let content = null

  if (!account) {
    content = (
      <span className="text-sm font-thin italic">No account is loaded</span>
    )
  } else {
    if (draft.data || isStartingComment || autoFocus) {
      content = (
        <CommentDraftEditor
          docId={docId}
          autoFocus={isStartingComment || autoFocus}
          initCommentDraft={draft.data}
          quotingBlockId={quotingBlockId}
          commentId={commentId}
          onDiscardDraft={() => {
            setIsStartingComment(false)
          }}
          onSuccess={({id}) => {
            setIsStartingComment(false)
            // if (route.key === 'document' && !!id) {
            //   const accessory = route.accessory
            //   const discussionsAccessory =
            //     accessory?.key === 'discussions' ? accessory : null
            //   replace({
            //     ...route,
            //     id: {
            //       ...route.id,
            //     },
            //     accessory: discussionsAccessory
            //       ? {
            //           ...discussionsAccessory,
            //           openComment: id,
            //         }
            //       : undefined,
            //   })
            // }
            queryClient.invalidateQueries({
              queryKey: [queryKeys.DOCUMENT_ACTIVITY], // all docs
            })
            queryClient.invalidateQueries({
              queryKey: [queryKeys.DOCUMENT_DISCUSSION], // all docs
            })
            queryClient.invalidateQueries({
              queryKey: [queryKeys.DOCUMENT_COMMENTS], // all docs
            })
            queryClient.invalidateQueries({
              queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY], // all docs
            })
            queryClient.invalidateQueries({
              queryKey: [queryKeys.DOC_CITATIONS], // all docs
            })

            queryClient.invalidateQueries({
              queryKey: [queryKeys.BLOCK_DISCUSSIONS], // all docs
            })
          }}
        />
      )
    } else {
      content = (
        <Button
          variant="ghost"
          className="text-muted-foreground m-0 h-auto flex-1 items-start justify-start border-0 px-[18px] py-3 text-left text-base hover:bg-transparent focus:bg-transparent"
          style={{backgroundColor: backgroundColor}}
          onClick={() => {
            setIsStartingComment(true)
          }}
        >
          <span className="text-sm font-thin italic">
            {commentId ? 'Reply in Discussion' : 'Start a new Discussion'}
          </span>
        </Button>
      )
    }
  }

  return (
    <div className="flex w-full items-start gap-2 px-4">
      <div className="flex shrink-0 grow-0">
        {account?.document?.metadata ? (
          <HMIcon
            id={account.id}
            metadata={account.document.metadata}
            size={32}
          />
        ) : (
          <UIAvatar id="?" label="?" size={32} />
        )}
      </div>

      <div className="bg-muted w-full flex-1 rounded-md">{content}</div>
    </div>
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

const CommentDraftEditor = memo(_CommentDraftEditor)
function _CommentDraftEditor({
  docId,
  onDiscardDraft,
  autoFocus,
  commentId,
  initCommentDraft,
  onSuccess,
  quotingBlockId,
}: {
  docId: UnpackedHypermediaId
  onDiscardDraft?: () => void
  autoFocus?: boolean
  commentId?: string
  initCommentDraft?: HMCommentDraft | null | undefined
  onSuccess?: (commentId: {id: string}) => void
  quotingBlockId?: string
}) {
  const [isHorizontal, setIsHorizontal] = useState(false)
  const sizeObserverdRef = useSizeObserver((rect) => {
    setIsHorizontal(rect.width > 322)
  })

  const {editor, onSubmit, onDiscard, isSaved, account, isSubmitting} =
    useCommentEditor(docId, {
      onDiscardDraft,
      commentId,
      initCommentDraft,
      onSuccess,
      quotingBlockId,
    })
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
    commentId,
  ])
  const contacts = useSelectedAccountContacts()

  if (!account) return null

  return (
    <div
      ref={sizeObserverdRef}
      className="comment-editor mt-1 flex flex-1 flex-col gap-2 px-4"
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement

        // Check if the clicked element is not an input, button, or textarea
        if (target.closest('input, textarea, select, button')) {
          return // Don't focus the editor in this case
        }
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
      // @ts-ignore
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
        <div className="flex items-center">
          <Tooltip
            content={`Publish Comment as "${account?.document?.metadata.name}"`}
          >
            <Button
              className="w-full flex-1"
              size="icon"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                if (isSubmitting) return
                e.stopPropagation()
                onSubmit()
              }}
              disabled={!isSaved.get() || isSubmitting}
            >
              <SendHorizonal className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Discard Comment Draft">
            <Button
              size="icon"
              onClick={(e: MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation()
                onDiscard()
              }}
            >
              <Trash className="text-destructive size-4" />
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
      // @ts-ignore
      referenceData.data?.type === 'document'
        ? // @ts-ignore
          referenceData.data.document?.content
        : undefined
    // @ts-ignore
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
    // @ts-ignore
  }, [referenceData.data])

  const highlight = useMemo(() => {
    if (!referenceId) return false
    if (route.key !== 'document') return false
    if (!route.id) return false
    if (!referenceId.blockRef) return false
    return referenceId.blockRef == route.id.blockRef
  }, [route, referenceId])

  {
    /* @ts-ignore */
  }
  if (!referenceData.data) return null

  return (
    <div
      className={`border-l-primary m-2 ml-0.5 flex w-full cursor-pointer items-center gap-3 border-l-2 ${
        highlight ? 'bg-secondary text-secondary-foreground' : 'bg-transparent'
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
        {/* @ts-expect-error */}
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
