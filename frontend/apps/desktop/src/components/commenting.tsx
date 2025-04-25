import {
  useCommentDraft,
  useCommentEditor,
  useDocumentCommentGroups,
} from '@/models/comments'
import {useMyAccounts} from '@/models/daemon'
import {useSubscribedEntities, useSubscribedEntity} from '@/models/entities'
import {useOpenUrl} from '@/open-url'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {EmbedToolbarProvider} from '@shm/editor/embed-toolbar-context'
import {getDocumentTitle} from '@shm/shared/content'
import {
  HMAccountsMetadata,
  HMBlockEmbed,
  HMBlockNode,
  HMComment,
  HMCommentDraft,
  HMCommentGroup,
  HMEntityContent,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {StateStream} from '@shm/shared/utils/stream'
import {CommentGroup} from '@shm/ui/discussion'
import {BlocksContent, getBlockNodeById} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {useIsDark} from '@shm/ui/use-is-dark'
import {useStream} from '@shm/ui/use-stream'
import {memo, useEffect, useMemo, useState} from 'react'
import {GestureResponderEvent} from 'react-native'
import {Button, SizableText, Tooltip, View, XStack, YStack} from 'tamagui'
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
      // onReplyBlock={onReplyBlock}
      // onReplyBlock={() => {}}
      // onCopyBlock={(
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

export function CommentReplies({
  docId,
  replyCommentId,
  rootReplyCommentId,
  onReplyClick,
  onReplyCountClick,
}: {
  docId: UnpackedHypermediaId
  replyCommentId: string
  rootReplyCommentId: string | null
  onReplyClick?: (replyCommentId: string, rootReplyCommentId: string) => void
  onReplyCountClick?: (
    replyCommentId: string,
    rootReplyCommentId: string,
  ) => void
}) {
  const commentGroupQueries = useDocumentCommentGroups(docId, replyCommentId)
  const comments = commentGroupQueries.data
  const authors = useCommentGroupAuthors(comments)
  return (
    <YStack paddingLeft={22}>
      {comments.map((commentGroup) => {
        return (
          <CommentGroup
            isNested
            key={commentGroup.id}
            docId={docId}
            authors={authors}
            renderCommentContent={renderCommentContent}
            commentGroup={commentGroup}
            isLastGroup={commentGroup === comments[comments.length - 1]}
            CommentReplies={CommentReplies}
            rootReplyCommentId={rootReplyCommentId}
            onReplyClick={onReplyClick}
            onReplyCountClick={onReplyCountClick}
          />
        )
      })}
    </YStack>
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
  const authorEntities = useSubscribedEntities(
    Array.from(commentGroupAuthors).map((uid) => ({id: hmId('d', uid)})),
  )
  return Object.fromEntries(
    authorEntities
      .map((q) => q.data)
      .filter((a) => !!a)
      .map((author) => [
        author.id.uid,
        {id: author.id, metadata: author.document?.metadata},
      ])
      .filter((author) => !!author[1]),
  )
}

export function RepliesEditor({
  isReplying,
  replyCommentId,
  docId,
  onDiscardDraft,
  onSuccess,
}: {
  isReplying: boolean
  docId: UnpackedHypermediaId
  replyCommentId: string
  onDiscardDraft: () => void
  onSuccess: (commentId: {id: string}) => void
}) {
  const isDark = useIsDark()
  const myAccountsQuery = useMyAccounts()
  const accounts = myAccountsQuery.map((query) => query.data).filter((a) => !!a)
  const draft = useCommentDraft(docId, replyCommentId)

  if (accounts.length === 0) return null
  if (!isReplying && !draft.data) return null
  return (
    <XStack
      borderRadius="$4"
      borderWidth={2}
      borderColor="$color8"
      minHeight={120}
      bg={isDark ? '$background' : '$backgroundStrong'}
    >
      <CommentDraftEditor
        docId={docId}
        replyCommentId={replyCommentId}
        accounts={accounts}
        autoFocus={isReplying}
        initCommentDraft={draft.data}
        onDiscardDraft={onDiscardDraft}
        onSuccess={onSuccess}
      />
    </XStack>
  )
}

export const CommentDraft = memo(_CommentDraft)
function _CommentDraft({
  docId,
  backgroundColor = '$color4',
  quotingBlockId,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId
  backgroundColor?: string
  quotingBlockId?: string
  replyCommentId?: string
}) {
  const myAccountsQuery = useMyAccounts()
  const accounts = myAccountsQuery.map((query) => query.data).filter((a) => !!a)
  const draft = useCommentDraft(docId, undefined)
  const route = useNavRoute()
  const replace = useNavigate('replace')
  let content = null
  let onPress = undefined
  const [isStartingComment, setIsStartingComment] = useState(false)
  if (!accounts?.length) return null
  if (draft.isInitialLoading) return null
  if (draft.data || isStartingComment) {
    content = (
      <CommentDraftEditor
        docId={docId}
        accounts={accounts}
        autoFocus={isStartingComment}
        initCommentDraft={draft.data}
        quotingBlockId={quotingBlockId}
        replyCommentId={replyCommentId}
        onDiscardDraft={() => {
          setIsStartingComment(false)
        }}
        onSuccess={({id}) => {
          if (route.key === 'document' && !!id) {
            replace({
              ...route,
              id: {
                ...route.id,
              },
              accessory: {
                ...route.accessory,
                openComment: id,
              },
            })
          }
        }}
      />
    )
  } else {
    content = (
      <Button
        paddingVertical={19}
        paddingHorizontal={18}
        f={1}
        textAlign="left"
        jc="flex-start"
        ai="flex-start"
        margin={0}
        chromeless
        color="$color8"
        fontSize={17}
        bg={backgroundColor}
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
        Start a new Discussion
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
      bg={backgroundColor}
    >
      {content}
    </YStack>
  )
}
const CommentDraftEditor = memo(_CommentDraftEditor)
function _CommentDraftEditor({
  docId,
  accounts,
  onDiscardDraft,
  autoFocus,
  replyCommentId,
  initCommentDraft,
  onSuccess,
  quotingBlockId,
}: {
  docId: UnpackedHypermediaId
  accounts: HMEntityContent[]
  onDiscardDraft?: () => void
  autoFocus?: boolean
  replyCommentId?: string
  initCommentDraft?: HMCommentDraft | null | undefined
  onSuccess?: (commentId: {id: string}) => void
  quotingBlockId?: string
}) {
  const {editor, onSubmit, onDiscard, isSaved, account, onSetAccount} =
    useCommentEditor(docId, accounts, {
      onDiscardDraft,
      replyCommentId,
      initCommentDraft,
      onSuccess,
      quotingBlockId,
    })
  const openUrl = useOpenUrl()
  useEffect(() => {
    if (autoFocus) editor._tiptapEditor.commands.focus()
  }, [autoFocus, editor])
  return (
    <YStack
      f={1}
      marginTop="$1"
      paddingHorizontal="$4"
      onPress={(e: GestureResponderEvent) => {
        const target = e.target as HTMLElement

        // Check if the clicked element is not an input, button, or textarea
        if (target.closest('input, textarea, select, button')) {
          return // Don't focus the editor in this case
        }
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
      onKeyDownCapture={(e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          editor._tiptapEditor.commands.blur()
          onSubmit()
          return true
        }
      }}
      gap="$4"
      paddingBottom="$2"
      className="comment-editor"
    >
      <AppDocContentProvider comment>
        <EmbedToolbarProvider>
          <HyperMediaEditorView editor={editor} openUrl={openUrl} comment />
        </EmbedToolbarProvider>
      </AppDocContentProvider>
      <XStack
        jc="flex-end"
        gap="$2"
        ai="center"
        // paddingVertical="$2"
        // marginHorizontal="$4"
        // marginTop="$6"
      >
        <AutosaveIndicator isSaved={isSaved} />
        <SelectAccountDropdown
          accounts={accounts}
          account={account}
          onSetAccount={onSetAccount}
        />
        <Button
          size="$2"
          // hoverStyle={{bg: '$blue9', borderColor: '$blue9'}}
          onPress={(e: GestureResponderEvent) => {
            e.stopPropagation()
            onSubmit()
          }}
          disabled={!isSaved.get()}
        >
          Publish
        </Button>
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
      </XStack>
    </YStack>
  )
}

const autosaveIndicatorSize = 6
function AutosaveIndicator({isSaved}: {isSaved: StateStream<boolean>}) {
  const currentIsSaved = useStream(isSaved)
  return (
    <View
      backgroundColor={currentIsSaved ? '$colorTransparent' : '$yellow10'}
      width={autosaveIndicatorSize}
      height={autosaveIndicatorSize}
      borderRadius={autosaveIndicatorSize / 2}
    />
  )
}

function SelectAccountDropdown({
  account,
  onSetAccount,
  accounts,
}: {
  account: StateStream<string | null>
  onSetAccount: (account: string) => void
  accounts: HMEntityContent[]
}) {
  const currentAccount = useStream(account)
  const options: {label: string; value: string; icon: React.ReactNode}[] =
    accounts.map((acct) => {
      return {
        label: getDocumentTitle(acct.document) || '',
        value: acct.id.uid,
        icon: (
          <HMIcon size={20} id={acct.id} metadata={acct.document?.metadata} />
        ),
      }
    })
  if (!options || !currentAccount) return null
  return (
    <SelectDropdown
      size="$2"
      options={options}
      value={currentAccount}
      onValue={onSetAccount}
    />
  )
}

function CommentReference({reference}: {reference: string | null}) {
  const route = useNavRoute()
  const navigate = useNavigate('replace')

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
      p="$2"
      width="100%"
      borderLeftWidth={2}
      borderLeftColor="$brand5"
      margin="$2"
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
      <SizableText
        size="$2"
        color="$color9"
        textAlign="left"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        overflow="hidden"
      >
        {commentReferenceContent({
          content: referenceContent || [],
        })}
      </SizableText>
    </XStack>
  )
}

function commentReferenceContent({content}: {content: Array<HMBlockNode>}) {
  let text = ''
  content.forEach((bn) => {
    if (bn.block.text) {
      text += bn.block.text
      text += ' '
    }
    if (bn.children?.length) {
      text += commentReferenceContent({content: bn.children})
    }
    text += ' '
  })

  return text
}
