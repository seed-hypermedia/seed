import {
  useCommentDraft,
  useCommentEditor,
  useDocumentCommentGroups,
} from '@/models/comments'
import {useMyAccounts} from '@/models/daemon'
import {useSubscribedEntities} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {
  getDocumentTitle,
  HMComment,
  HMCommentGroup,
  HMEntityContent,
  hmId,
  HMMetadata,
  StateStream,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  BlocksContent,
  Button,
  CommentGroup,
  HMIcon,
  SelectDropdown,
  Tooltip,
  useStream,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {Trash} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {HyperMediaEditorView} from './editor'

export function Discussion({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <YStack paddingVertical="$6" marginBottom={100} gap="$4">
      <CommentDraft docId={docId} />
      <DiscussionComments docId={docId} />
    </YStack>
  )
}

function renderCommentContent(comment: HMComment) {
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
      <BlocksContent blocks={comment.content} parentBlockId={null} />
    </AppDocContentProvider>
  )
}

function DiscussionComments({docId}: {docId: UnpackedHypermediaId}) {
  const comments = useDocumentCommentGroups(docId)
  const authors = useCommentGroupAuthors(comments)
  return comments.map((commentGroup) => {
    return (
      <CommentGroup
        key={commentGroup.id}
        docId={docId}
        commentGroup={commentGroup}
        isLastGroup={commentGroup === comments[comments.length - 1]}
        authors={authors}
        renderCommentContent={renderCommentContent}
        RepliesEditor={RepliesEditor}
        CommentReplies={CommentReplies}
      />
    )
  })
}

function CommentReplies({
  docId,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId
  replyCommentId: string
}) {
  const comments = useDocumentCommentGroups(docId, replyCommentId)
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
            RepliesEditor={RepliesEditor}
            CommentReplies={CommentReplies}
          />
        )
      })}
    </YStack>
  )
}

function useCommentGroupAuthors(
  commentGroups: HMCommentGroup[],
): Record<string, HMMetadata> {
  const commentGroupAuthors = new Set<string>()
  commentGroups.forEach((commentGroup) => {
    commentGroup.comments.forEach((comment) => {
      commentGroupAuthors.add(comment.author)
    })
  })
  const authorEntities = useSubscribedEntities(
    Array.from(commentGroupAuthors).map((uid) => hmId('d', uid)),
  )
  return Object.fromEntries(
    authorEntities
      .map((q) => q.data)
      .filter((a) => !!a)
      .map((author) => [author.id.uid, author.document?.metadata])
      .filter((author) => !!author[1]),
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
    <XStack
      borderRadius="$4"
      borderWidth={2}
      borderColor="$color8"
      minHeight={120}
      bg="$background"
    >
      <CommentDraftEditor
        docId={docId}
        replyCommentId={replyCommentId}
        accounts={accounts}
        autoFocus={isReplying}
        onDiscardDraft={onDiscardDraft}
      />
    </XStack>
  )
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
        paddingVertical={19}
        paddingHorizontal={18}
        f={1}
        textAlign="left"
        jc="flex-start"
        ai="flex-start"
        margin={0}
        chromeless
        color="$color7"
        fontSize={17}
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
      minHeight={105}
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
      marginTop="$1"
      paddingHorizontal="$4"
      onPress={(e: MouseEvent) => {
        e.stopPropagation()
        editor._tiptapEditor.commands.focus()
      }}
      gap="$4"
      paddingBottom="$2"
    >
      <AppDocContentProvider disableEmbedClick>
        <HyperMediaEditorView editor={editor} comment />
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
          onPress={onSubmit}
          disabled={!isSaved}
        >
          Publish
        </Button>
        <Tooltip content="Discard Comment Draft">
          <Button
            // marginLeft="$2"
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
        <HMIcon size={20} id={acct.id} metadata={acct.document?.metadata} />
      ),
    }
  })
  if (!options || !currentAccount) return null
  return (
    <SelectDropdown
      width={240}
      size="$2"
      options={options}
      value={currentAccount}
      onValue={onSetAccount}
    />
  )
}
