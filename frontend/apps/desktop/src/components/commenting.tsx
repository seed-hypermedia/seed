import {useCommentDraft, useCommentEditor} from '@/models/comments'
import {useContacts} from '@/models/contacts'
import {useSubscribedResource} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {AppBlocksContentProvider} from '@/pages/document-content-provider'
import {useSelectedAccount} from '@/selected-account'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
  handleDragMedia,
} from '@/utils/media-drag'
import {useNavigate} from '@/utils/useNavigate'
import {queryClient, queryKeys} from '@shm/shared'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useCallback} from 'react'

import {useSizeObserver} from '@/utils/use-size-observer'
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
  useBlocksContentContext,
} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {SendHorizonal} from 'lucide-react'
import {memo, MouseEvent, useEffect, useMemo, useState} from 'react'
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
    <AppBlocksContentProvider comment textUnit={14} layoutUnit={16}>
      <div className="flex w-full flex-col">
        <CommentReference reference={data.reference} />
        <BlocksContent blocks={data.content} parentBlockId={null} />
      </div>
    </AppBlocksContentProvider>
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

  const {editor, onSubmit, onDiscard, isSaved, account, isSubmitting} =
    useCommentEditor(docId, {
      onDiscardDraft,
      commentId,
      initCommentDraft,
      onSuccess,
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
      className="comment-editor ring-px ring-border mt-1 flex flex-1 flex-col gap-2 px-4 ring"
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
      <div className="flex-1">
        <AppBlocksContentProvider comment textUnit={14} layoutUnit={16}>
          <HyperMediaEditorView editor={editor} openUrl={openUrl} comment />
        </AppBlocksContentProvider>
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
  const context = useBlocksContentContext()
  const referenceId = useMemo(() => {
    if (!reference) return null
    return unpackHmId(reference)
  }, [reference])

  const referenceData = useSubscribedResource(referenceId)

  const referenceContent = useMemo(() => {
    const content =
      // @ts-ignore
      referenceData.data?.type == 'document'
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
    if (route.key != 'document' && route.key != 'feed') return false
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
        highlight ? 'bg-accent text-accent-foreground' : 'bg-transparent'
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
        if (
          (route.key == 'document' || route.key == 'feed') &&
          referenceId?.blockRef
        ) {
          navigate({
            ...route,
            // @ts-expect-error
            isBlockFocused: route.key == 'feed' ? undefined : false,
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
        <AppBlocksContentProvider
          {...context}
          comment
          textUnit={14}
          layoutUnit={16}
        >
          <BlocksContent
            blocks={referenceContent}
            parentBlockId={null}
            expanded={false}
            hideCollapseButtons
          />
        </AppBlocksContentProvider>
      </div>
    </div>
  )
}
