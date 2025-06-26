import {useCommentDraft, useCommentEditor} from '@/models/comments'
import {useContacts, useSelectedAccountContacts} from '@/models/contacts'
import {useSubscribedEntity} from '@/models/entities'
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
import {
  BlocksContent,
  getBlockNodeById,
  useDocContentContext,
} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {useStream} from '@shm/ui/use-stream'
import {memo, useEffect, useMemo, useState} from 'react'
import {GestureResponderEvent} from 'react-native'
import {Button, View, XStack, YStack} from 'tamagui'
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
      <YStack w="100%">
        <CommentReference reference={data.reference} />
        <BlocksContent blocks={data.content} parentBlockId={null} />
      </YStack>
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
  backgroundColor = '$colorTransparent',
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
        paddingVertical={16}
        paddingHorizontal={18}
        f={1}
        textAlign="left"
        jc="flex-start"
        ai="flex-start"
        margin={0}
        chromeless
        color="$color8"
        fontSize={17}
        hoverStyle={{bg: backgroundColor}}
        focusStyle={{bg: backgroundColor, borderWidth: 0}}
        borderWidth={0}
        // fontStyle="italic"
        h="auto"
        // icon={
        //   <>
        //     <Plus color="$color7" size={20} />
        //     <GripVertical color="$color7" size={20} />
        //   </>
        // }
        onPress={() => {
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
    <YStack
      borderRadius="$4"
      // borderWidth={2}
      // borderColor="$color8"
      minHeight={105}
      onPress={onPress}
      // bg={backgroundColor}
    >
      {content}
    </YStack>
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
    <YStack
      ref={sizeObserverdRef}
      f={1}
      marginTop="$1"
      paddingHorizontal="$4"
      onPress={(e: GestureResponderEvent) => {
        // @ts-expect-error fix this type in the future!
        const target = e.target as HTMLElement

        // Check if the clicked element is not an input, button, or textarea
        if (target.closest('input, textarea, select, button')) {
          return // Don't focus the editor in this case
        }
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
      // @ts-expect-error fix this type in the future!
      onKeyDownCapture={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          editor._tiptapEditor.commands.blur()
          onSubmit()
          return true
        }
      }}
      // paddingBottom="$2"
      className="comment-editor"
    >
      <div className="flex-1">
        <AppDocContentProvider comment contacts={contacts.data}>
          <HyperMediaEditorView editor={editor} openUrl={openUrl} comment />
        </AppDocContentProvider>
      </div>
      <View
        alignSelf="flex-end"
        maxWidth={320}
        w="100%"
        gap="$2"
        f={1}
        flexDirection={isHorizontal ? 'row' : 'column'}
        ai={isHorizontal ? 'center' : undefined}
      >
        <div className="flex flex-1 items-center">
          <AutosaveIndicator isSaved={isSaved} />
        </div>
        <div className="flex gap-2">
          <Tooltip
            content={`Publish Comment as "${account?.document?.metadata.name}"`}
          >
            <Button
              flex={1}
              w="100%"
              size="$2"
              onPress={(e: GestureResponderEvent) => {
                e.stopPropagation()
                onSubmit()
              }}
              disabled={!isSaved.get()}
            >
              {account ? (
                <HMIcon
                  id={account.id}
                  metadata={account.document?.metadata}
                  size={20}
                />
              ) : null}
              Publish
            </Button>
          </Tooltip>
          <Tooltip content="Discard Comment Draft">
            <Button
              // marginLeft="$2"
              size="$2"
              onPress={(e: GestureResponderEvent) => {
                e.stopPropagation()
                onDiscard()
              }}
              theme="red"
              icon={Trash}
            />
          </Tooltip>
        </div>
      </View>
    </YStack>
  )
}

const autosaveIndicatorSize = 6
function AutosaveIndicator({isSaved}: {isSaved: StateStream<boolean>}) {
  const currentIsSaved = useStream(isSaved)
  return (
    <View
      position="absolute"
      top={0}
      left={0}
      x={-12}
      y={10}
      backgroundColor={currentIsSaved ? '$colorTransparent' : '$yellow10'}
      width={autosaveIndicatorSize}
      height={autosaveIndicatorSize}
      borderRadius={autosaveIndicatorSize / 2}
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

  const referenceData = useSubscribedEntity(referenceId)

  const referenceContent = useMemo(() => {
    if (!referenceData.data) return null
    if (referenceId?.blockRef) {
      let bn = getBlockNodeById(
        referenceData.data.document?.content || [],
        referenceId.blockRef,
      )
      if (bn) {
        return [bn]
      } else {
        return referenceData.data.document?.content || []
      }
    }

    return referenceData.data.document?.content || []
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
    <XStack
      gap="$3"
      ai="center"
      width="100%"
      borderLeftWidth={2}
      borderLeftColor="$brand5"
      margin="$2"
      onHoverIn={() => {
        if (referenceId) {
          context.onHoverIn?.(referenceId)
        }
      }}
      onHoverOut={() => {
        if (referenceId) {
          context.onHoverOut?.(referenceId)
        }
      }}
      bg={highlight ? '$brand12' : '$colorTransparent'}
      x={2}
      onPress={() => {
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
      <View opacity={0.5} f={1}>
        <AppDocContentProvider {...context} comment>
          <BlocksContent
            blocks={referenceContent}
            parentBlockId={null}
            expanded={false}
            hideCollapseButtons
          />
        </AppDocContentProvider>
      </View>
    </XStack>
  )
}
