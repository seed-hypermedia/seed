import {useCommentDraft, useCommentEditor} from '@/models/comments'
import {useOpenUrl} from '@/open-url'
import {useSelectedAccount} from '@/selected-account'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
  handleDragMedia,
} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {commentIdToHmId, queryClient, queryKeys} from '@shm/shared'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useCallback} from 'react'

import {usePushResource} from '@/models/documents'
import {useSizeObserver} from '@/utils/use-size-observer'
import {
  HMCommentDraft,
  HMCommentGroup,
  HMListDiscussionsOutput,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useContacts} from '@shm/shared/models/entity'
import {useStream} from '@shm/shared/use-stream'
import {StateStream} from '@shm/shared/utils/stream'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Tooltip} from '@shm/ui/tooltip'
import {SendHorizonal} from 'lucide-react'
import {memo, MouseEvent, useEffect, useState} from 'react'
import {HyperMediaEditorView} from './editor'

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
  const {
    docId,
    backgroundColor = 'transparent',
    quotingBlockId,
    commentId,
    autoFocus,
    context,
  } = props

  const account = useSelectedAccount()
  const draft = useCommentDraft(
    quotingBlockId ? {...docId, blockRef: quotingBlockId} : docId,
    commentId,
    quotingBlockId,
    context,
  )
  const route = useNavRoute()
  const navigate = useNavigate('replace')

  // Clear autoFocus from route after it's been used
  useEffect(() => {
    if (
      autoFocus &&
      route.key === 'document' &&
      route.accessory?.key === 'activity'
    ) {
      const accessory = route.accessory
      if (accessory.autoFocus) {
        setTimeout(() => {
          const {autoFocus: _, ...restAccessory} = accessory
          navigate({
            ...route,
            accessory: restAccessory,
          })
        }, 150)
      }
    }
  }, [autoFocus])

  if (draft.isInitialLoading) return null

  let content = null

  if (!account) {
    content = (
      <span className="text-sm font-thin italic">No account is loaded</span>
    )
  } else {
    content = (
      <CommentDraftEditor
        docId={docId}
        autoFocus={autoFocus}
        initCommentDraft={draft.data}
        quotingBlockId={quotingBlockId}
        commentId={commentId}
        context={context}
        onDiscardDraft={() => {}}
        onSuccess={() => {
          // Don't invalidate draft queries here - removeDraft mutation handles it via optimistic updates
          queryClient.invalidateQueries({
            queryKey: [queryKeys.DOCUMENT_ACTIVITY],
          })
          queryClient.invalidateQueries({
            queryKey: [queryKeys.DOCUMENT_DISCUSSION],
          })
          queryClient.invalidateQueries({
            queryKey: [queryKeys.DOCUMENT_COMMENTS],
          })
          queryClient.invalidateQueries({
            queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY],
          })
          queryClient.invalidateQueries({
            queryKey: [queryKeys.DOC_CITATIONS],
          })
          queryClient.invalidateQueries({
            queryKey: [queryKeys.BLOCK_DISCUSSIONS],
          })
          queryClient.invalidateQueries({
            queryKey: [queryKeys.ACTIVITY_FEED],
          })
        }}
      />
    )
  }

  return (
    <div className="flex w-full items-start gap-2">
      <div className="flex shrink-0 grow-0">
        {account ? (
          <HMIcon
            id={account.id}
            name={account.document?.metadata?.name}
            icon={account.document?.metadata?.icon}
            size={32}
          />
        ) : (
          <UIAvatar id="no-account" size={32} />
        )}
      </div>

      <div className="bg-muted w-full min-w-0 flex-1 rounded-md">{content}</div>
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
  context,
}: {
  docId: UnpackedHypermediaId
  onDiscardDraft?: () => void
  autoFocus?: boolean
  commentId?: string
  initCommentDraft?: HMCommentDraft | null | undefined
  onSuccess?: (commentId: {id: string}) => void
  quotingBlockId?: string
  context?: 'accessory' | 'feed' | 'document-content'
}) {
  const [isHorizontal, setIsHorizontal] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const sizeObserverdRef = useSizeObserver((rect) => {
    setIsHorizontal(rect.width > 322)
  })
  const pushResource = usePushResource()
  const {editor, onSubmit, onDiscard, isSaved, account, isSubmitting} =
    useCommentEditor(docId, {
      onDiscardDraft,
      commentId,
      initCommentDraft,
      onSuccess: (successData: {id: string}) => {
        pushResource(commentIdToHmId(successData.id))
        onSuccess?.(successData)
      },
      quotingBlockId,
      context,
      autoFocus,
    })
  const openUrl = useOpenUrl()

  if (!account) return null

  const focusEditor = useCallback(() => {
    if (editor?._tiptapEditor) {
      editor._tiptapEditor.commands.focus()
    }
  }, [editor])

  useEffect(() => {
    const focusKey = `${docId.id}-${commentId || quotingBlockId}`
    const subscribers = focusSubscribers.get(focusKey)
    if (subscribers) {
      subscribers.add(focusEditor)
    } else {
      focusSubscribers.set(focusKey, new Set([focusEditor]))
    }

    return () => {
      const subscribers = focusSubscribers.get(focusKey)
      if (subscribers) {
        subscribers.delete(focusEditor)
      }
    }
  }, [docId.id, commentId, quotingBlockId, focusEditor])

  function onDrop(event: React.DragEvent) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer?.files && dataTransfer.files.length > 0) {
      event.preventDefault()

      // Iterate through all dropped files
      const files = Array.from(dataTransfer.files)

      // Get the current block ID where files should be inserted
      const currentBlock = editor.getTextCursorPosition().block
      let lastInsertedBlockId = currentBlock.id

      // Process files sequentially to maintain order
      files.reduce((promise, file) => {
        return promise.then(async () => {
          try {
            const props = await handleDragMedia(file)
            if (!props) return

            let blockType: string
            if (chromiumSupportedImageMimeTypes.has(file.type)) {
              blockType = 'image'
            } else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
              blockType = 'video'
            } else {
              blockType = 'file'
            }

            const newBlockId = generateBlockId()
            const mediaBlock = {
              id: newBlockId,
              type: blockType,
              props: {
                url: props.url,
                name: props.name,
                ...(blockType === 'file' ? {size: props.size} : {}),
              },
              content: [],
              children: [],
            }

            // Insert after the last inserted block (or current block for first file)
            editor.insertBlocks([mediaBlock], lastInsertedBlockId, 'after')

            // Update the last inserted block ID for next iteration
            lastInsertedBlockId = newBlockId
          } catch (error) {
            console.error('Failed to upload file:', file.name, error)
          }
        })
      }, Promise.resolve())

      setIsDragging(false)
      return
    }
  }

  return (
    <div
      ref={sizeObserverdRef}
      className="comment-editor ring-px ring-border mt-1 flex min-w-0 flex-1 flex-col gap-2 overflow-x-hidden px-4 ring"
      onDragStart={() => {
        setIsDragging(true)
      }}
      onDragEnd={() => {
        setIsDragging(false)
      }}
      onDragOver={(event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDrop={onDrop}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement

        // Check if the clicked element is not an input, button, or textarea
        if (target.closest('input, textarea, select, button')) {
          return // Don't focus the editor in this case
        }
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
    >
      <div className="min-w-0 flex-1">
        <HyperMediaEditorView editor={editor} openUrl={openUrl} comment />
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
        </div>
      </div>
    </div>
  )
}

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
