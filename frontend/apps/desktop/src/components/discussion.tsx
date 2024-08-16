import {
  useCommentDraft,
  useCommentEditor,
  useDocumentCommentGroups,
} from '@/models/comments'
import {useMyAccounts} from '@/models/daemon'
import {useEntity} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {
  BlockRange,
  ExpandedBlockRange,
  formattedDateLong,
  formattedDateMedium,
  getDocumentTitle,
  HMComment,
  HMCommentGroup,
  HMEntityContent,
  hmId,
  serializeBlockRange,
  StateStream,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  BlocksContent,
  Button,
  copyUrlToClipboardWithFeedback,
  ReplyArrow,
  SelectDropdown,
  SizableText,
  Tooltip,
  useStream,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {ChevronDown, ChevronRight, Trash} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {HyperMediaEditorView} from './editor'
import {Thumbnail} from './thumbnail'

export function Discussion({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <YStack paddingVertical="$6" marginBottom={100} gap="$4">
      <CommentDraft docId={docId} />
      <DiscussionComments docId={docId} />
    </YStack>
  )
}

function DiscussionComments({docId}: {docId: UnpackedHypermediaId}) {
  const comments = useDocumentCommentGroups(docId)
  return comments.map((commentGroup) => {
    return (
      <CommentGroup
        key={commentGroup.id}
        docId={docId}
        commentGroup={commentGroup}
      />
    )
  })
}

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
function CommentGroup({
  docId,
  commentGroup,
}: {
  docId: UnpackedHypermediaId
  commentGroup: HMCommentGroup
}) {
  const lastComment = commentGroup.comments.at(-1)
  return commentGroup.comments.map((comment) => {
    const isLastCommentInGroup = !!lastComment && comment === lastComment
    return (
      <Comment
        key={comment.id}
        docId={docId}
        comment={comment}
        replyCount={
          isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
        }
      />
    )
  })
}

function Comment({
  docId,
  comment,
  replyCount,
}: {
  docId: UnpackedHypermediaId
  comment: HMComment
  replyCount?: number
}) {
  const [showReplies, setShowReplies] = useState(false)
  const [isReplying, setIsReplying] = useState(false)
  const authorId = hmId('d', comment.author)
  const {data: author} = useEntity(authorId)
  const draft = useCommentDraft(docId, comment.id)

  return (
    <YStack>
      <XStack gap="$2" padding="$2">
        <Thumbnail
          id={authorId}
          metadata={author?.document?.metadata}
          size={20}
        />
        <YStack f={1}>
          <XStack minHeight={20} ai="center" gap="$2">
            <SizableText size="$2" fontWeight="bold">
              {author?.document?.metadata.name || '...'}
            </SizableText>
            <Tooltip content={formattedDateLong(comment.createTime)}>
              <SizableText color="$color8" size="$1">
                {formattedDateMedium(comment.createTime)}
              </SizableText>
            </Tooltip>
          </XStack>
          <XStack marginLeft={-8}>
            <AppDocContentProvider
              comment
              // onReplyBlock={onReplyBlock}
              onReplyBlock={() => {}}
              onCopyBlock={(
                blockId: string,
                blockRange: BlockRange | ExpandedBlockRange | undefined,
              ) => {
                const url = `${comment.id}#${blockId}${serializeBlockRange(
                  blockRange,
                )}`
                copyUrlToClipboardWithFeedback(url, 'Comment Block')
              }}
            >
              <BlocksContent blocks={comment.content} parentBlockId={null} />
            </AppDocContentProvider>
          </XStack>
          <XStack ai="center" gap="$2" marginLeft={-4} paddingVertical="$1">
            {replyCount ? (
              <Button
                chromeless
                color="$blue11"
                size="$1"
                theme="blue"
                icon={showReplies ? ChevronDown : ChevronRight}
                onPress={() => setShowReplies(!showReplies)}
              >
                <SizableText size="$1" color="$blue11">
                  Replies ({replyCount})
                </SizableText>
              </Button>
            ) : null}
            <Button
              chromeless
              color="$blue11"
              size="$1"
              theme="blue"
              icon={<ReplyArrow size={16} />}
              onPress={() => setIsReplying(true)}
            >
              Reply
            </Button>
          </XStack>
        </YStack>
      </XStack>
      <RepliesEditor
        isReplying={isReplying || !!draft.data}
        docId={docId}
        replyCommentId={comment.id}
        onDiscardDraft={() => {
          setIsReplying(false)
        }}
      />
      {showReplies ? (
        <YStack paddingLeft={32}>
          <CommentReplies docId={docId} replyCommentId={comment.id} />
        </YStack>
      ) : null}
    </YStack>
  )
}

function RepliesEditor({
  isReplying,
  replyCommentId,
  docId,
  onDiscardDraft,
}: {
  isReplying: boolean
  docId: UnpackedHypermediaId
  replyCommentId: string
  onDiscardDraft: () => void
}) {
  const myAccountsQuery = useMyAccounts()
  const accounts = myAccountsQuery.map((query) => query.data).filter((a) => !!a)
  if (accounts.length === 0) return null
  if (!isReplying) return null
  return (
    <CommentDraftEditor
      docId={docId}
      replyCommentId={replyCommentId}
      accounts={accounts}
      autoFocus={isReplying}
      onDiscardDraft={onDiscardDraft}
    />
  )
}

function CommentReplies({
  docId,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId
  replyCommentId: string
}) {
  const comments = useDocumentCommentGroups(docId, replyCommentId)
  // todo, indentation, etc..
  return comments.map((commentGroup) => {
    return (
      <CommentGroup
        key={commentGroup.id}
        docId={docId}
        commentGroup={commentGroup}
      />
    )
  })
}

function CommentDraft({docId}: {docId: UnpackedHypermediaId}) {
  const myAccountsQuery = useMyAccounts()
  const accounts = myAccountsQuery.map((query) => query.data).filter((a) => !!a)
  const draft = useCommentDraft(docId, undefined)
  let content = null
  let onPress = undefined
  const [isStartingComment, setIsStartingComment] = useState(false)
  if (!accounts?.length) return null
  if (draft.data || isStartingComment) {
    content = (
      <CommentDraftEditor
        docId={docId}
        accounts={accounts}
        autoFocus={isStartingComment}
        onDiscardDraft={() => {
          setIsStartingComment(false)
        }}
      />
    )
  } else {
    content = (
      <Button
        paddingTop={31}
        paddingHorizontal={56}
        f={1}
        textAlign="left"
        jc="flex-start"
        ai="flex-start"
        margin={0}
        chromeless
        color="$color7"
        fontSize={18}
        fontStyle="italic"
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
        Enter text or type '/' for commands
      </Button>
    )
  }
  return (
    <XStack
      borderRadius="$4"
      borderWidth={2}
      borderColor="$color8"
      minHeight={130}
      onPress={onPress}
    >
      {content}
    </XStack>
  )
}

function CommentDraftEditor({
  docId,
  accounts,
  onDiscardDraft,
  autoFocus,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId
  accounts: HMEntityContent[]
  onDiscardDraft?: () => void
  autoFocus?: boolean
  replyCommentId?: string
}) {
  const {editor, onSubmit, onDiscard, isSaved, account, onSetAccount} =
    useCommentEditor(docId, accounts, {
      onDiscardDraft,
      replyCommentId,
    })
  useEffect(() => {
    if (autoFocus) editor._tiptapEditor.commands.focus()
  }, [autoFocus, editor])
  return (
    <YStack
      f={1}
      marginTop="$3"
      paddingLeft="$10"
      onPress={(e: MouseEvent) => {
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
    >
      <AppDocContentProvider disableEmbedClick>
        <HyperMediaEditorView editor={editor} editable />
      </AppDocContentProvider>
      <XStack
        jc="flex-end"
        gap="$2"
        ai="center"
        paddingVertical="$2"
        marginHorizontal="$4"
        marginTop="$4"
      >
        <AutosaveIndicator isSaved={isSaved} />
        <SelectAccountDropdown
          accounts={accounts}
          account={account}
          onSetAccount={onSetAccount}
        />
        <Button
          size="$2"
          bg="$blue8"
          borderColor="$blue8"
          color="$color1"
          hoverStyle={{bg: '$blue9', borderColor: '$blue9'}}
          onPress={onSubmit}
          disabled={!isSaved}
        >
          Publish
        </Button>
        <Tooltip content="Discard Comment Draft">
          <Button
            marginLeft="$2"
            size="$2"
            onPress={onDiscard}
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
  const options = accounts.map((acct) => {
    return {
      label: getDocumentTitle(acct.document),
      value: acct.id.uid,
      icon: (
        <Thumbnail size={20} id={acct.id} metadata={acct.document?.metadata} />
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
