import {EmbedToolbarProvider} from '@/editor/embed-toolbar-context'
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
  HMCommentDraft,
  HMCommentGroup,
  HMEntityContent,
  hmId,
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
  Trash,
  useStream,
  View,
  XStack,
  YStack,
} from '@shm/ui'
import {memo, useEffect, useState} from 'react'
import {HyperMediaEditorView} from './editor'

export function renderCommentContent(comment: HMComment) {
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

export function CommentReplies({
  docId,
  replyCommentId,
}: {
  docId: UnpackedHypermediaId
  replyCommentId: string
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
            RepliesEditor={RepliesEditor}
            CommentReplies={CommentReplies}
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
}: {
  isReplying: boolean
  docId: UnpackedHypermediaId
  replyCommentId: string
  onDiscardDraft: () => void
}) {
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
      bg="$background"
    >
      <CommentDraftEditor
        docId={docId}
        replyCommentId={replyCommentId}
        accounts={accounts}
        autoFocus={isReplying}
        initCommentDraft={draft.data}
        onDiscardDraft={onDiscardDraft}
      />
    </XStack>
  )
}

export const CommentDraft = memo(_CommentDraft)
function _CommentDraft({docId}: {docId: UnpackedHypermediaId}) {
  const myAccountsQuery = useMyAccounts()
  const accounts = myAccountsQuery.map((query) => query.data).filter((a) => !!a)
  const draft = useCommentDraft(docId, undefined)
  let content = null
  let onPress = undefined
  const [isStartingComment, setIsStartingComment] = useState(false)
  const bgColor = '$color4'
  if (!accounts?.length) return null
  if (draft.isInitialLoading) return null
  if (draft.data || isStartingComment) {
    content = (
      <CommentDraftEditor
        docId={docId}
        accounts={accounts}
        autoFocus={isStartingComment}
        initCommentDraft={draft.data}
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
        color="$color8"
        fontSize={17}
        bg={bgColor}
        hoverStyle={{bg: bgColor}}
        focusStyle={{bg: bgColor, borderWidth: 0}}
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
        What are your thoughts?
      </Button>
    )
  }
  return (
    <XStack
      borderRadius="$4"
      // borderWidth={2}
      // borderColor="$color8"
      minHeight={105}
      onPress={onPress}
      bg={bgColor}
    >
      {content}
    </XStack>
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
}: {
  docId: UnpackedHypermediaId
  accounts: HMEntityContent[]
  onDiscardDraft?: () => void
  autoFocus?: boolean
  replyCommentId?: string
  initCommentDraft?: HMCommentDraft | null | undefined
}) {
  const {editor, onSubmit, onDiscard, isSaved, account, onSetAccount} =
    useCommentEditor(docId, accounts, {
      onDiscardDraft,
      replyCommentId,
      initCommentDraft,
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
        <EmbedToolbarProvider>
          <HyperMediaEditorView editor={editor} comment />
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
