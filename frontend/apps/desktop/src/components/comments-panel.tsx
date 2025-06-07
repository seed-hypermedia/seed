import {useEntityCitations} from '@/models/citations'
import {useAllDocumentComments} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {DocumentDiscussionsAccessory, pluralS} from '@shm/shared'
import {useCommentGroups, useCommentParents} from '@shm/shared/discussion'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useAccounts, useEntity} from '@shm/shared/models/entity'
import {useTxString} from '@shm/shared/translation'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {CommentGroup, QuotedDocBlock} from '@shm/ui/discussion'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {MessageSquareOff} from '@tamagui/lucide-icons'
import {YStack} from '@tamagui/stacks'
import {memo, useEffect, useMemo, useState} from 'react'
import {Button, Separator, View} from 'tamagui'
import {AccessoryContent} from './accessory-sidebar'
import {CommentCitationEntry} from './citations-panel'
import {
  CommentBox,
  renderCommentContent,
  triggerCommentDraftFocus,
  useCommentGroupAuthors,
} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel({
  docId,
  onAccessory,
  accessory: {openComment, openBlockId, blockRange, autoFocus, isReplying},
}: {
  docId: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (acc: DocumentDiscussionsAccessory) => void
}) {
  if (openComment) {
    return (
      <CommentReplyAccessory
        docId={docId}
        onBack={() => onAccessory({key: 'discussions'})}
        commentId={openComment}
        isReplying={isReplying}
      />
    )
  }
  if (openBlockId) {
    return (
      <CommentBlockAccessory
        docId={docId}
        blockId={openBlockId}
        autoFocus={autoFocus}
        onBack={() => onAccessory({key: 'discussions'})}
      />
    )
  }
  return <AllComments docId={docId} />
}

function AllComments({docId}: {docId: UnpackedHypermediaId}) {
  const comments = useAllDocumentComments(docId)
  const commentGroups = useCommentGroups(comments.data)
  const authors = useCommentGroupAuthors(commentGroups.data)

  let panelContent = null
  if (comments.isLoading && !comments.data) {
    panelContent = null
  } else if (comments.data) {
    panelContent =
      commentGroups.data?.length > 0 ? (
        commentGroups.data?.map((cg, idx) => {
          return (
            <YStack
              key={cg.id}
              paddingHorizontal="$1.5"
              marginBottom={commentGroups.data?.length - 1 > idx ? '$4' : 0}
            >
              <CommentGroup
                rootReplyCommentId={null}
                key={cg.id}
                commentGroup={cg}
                authors={authors}
                renderCommentContent={renderCommentContent}
                enableReplies={true}
              />
              {commentGroups.data?.length - 1 > idx && <Separator />}
            </YStack>
          )
        })
      ) : (
        <EmptyDiscussions docId={docId} />
      )
  }
  return (
    <AccessoryContent
      footer={
        <View paddingVertical="$2">
          <CommentBox docId={docId} backgroundColor="$colorTransparent" />
        </View>
      }
    >
      <YStack>{panelContent}</YStack>
    </AccessoryContent>
  )
}

function CommentBlockAccessory({
  docId,
  blockId,
  autoFocus,
  onBack,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  autoFocus?: boolean
  onBack: () => void
}) {
  const tx = useTxString()
  const citations = useEntityCitations(docId)
  const citationsForBlock = citations.data?.filter((citation) => {
    return (
      citation.targetFragment?.blockId === blockId &&
      citation.source.type === 'c'
    )
  })
  const accountIds = new Set<string>()
  citationsForBlock?.forEach((citation) => {
    citation.source.author && accountIds.add(citation.source.author)
  })
  const doc = useEntity(docId)
  const accounts = useAccountsMetadata(Array.from(accountIds))
  let quotedContent = null
  if (doc.data?.document) {
    quotedContent = (
      <QuotedDocBlock docId={docId} blockId={blockId} doc={doc.data.document} />
    )
  } else if (doc.isInitialLoading) {
    quotedContent = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  let panelContent = null
  if (citations.data) {
    panelContent =
      citationsForBlock && citationsForBlock.length > 0 ? (
        citationsForBlock?.map((citation) => {
          return (
            <CommentCitationEntry
              citation={citation}
              key={citation.source.id.id}
              accounts={accounts}
            />
          )
        })
      ) : (
        <EmptyDiscussions docId={docId} commentId={blockId} />
      )
  }
  return (
    <AccessoryContent
      footer={
        <View padding="$3">
          <CommentBox docId={docId} quotingBlockId={blockId} />
        </View>
      }
    >
      <AccessoryBackButton onPress={onBack} label={tx('All Discussions')} />
      <AppDocContentProvider docId={docId}>
        {quotedContent}
      </AppDocContentProvider>
      {panelContent}
    </AccessoryContent>
  )
}

function CommentReplyAccessory({
  docId,
  onBack,
  commentId,
  isReplying,
}: {
  docId: UnpackedHypermediaId
  onBack: () => void
  commentId: string
  isReplying?: boolean
}) {
  const comments = useAllDocumentComments(docId)
  const threadComments = useCommentParents(comments.data, commentId)
  const threadAuthorIds = useMemo(() => {
    return threadComments?.map((doc) => doc.author) || []
  }, [threadComments])
  const commentAuthors = useAccounts(threadAuthorIds)
  const rootCommentId = threadComments?.at(0)?.id
  const tx = useTxString()
  return (
    <AccessoryContent
      footer={
        isReplying ? (
          <View padding="$3">
            <CommentBox
              docId={docId}
              autoFocus={isReplying}
              replyCommentId={commentId}
            />
          </View>
        ) : null
      }
    >
      <AccessoryBackButton onPress={onBack} label={tx('All Discussions')} />
      {rootCommentId && threadComments ? (
        threadComments.length > 0 ? (
          <CommentGroup
            commentGroup={{
              id: rootCommentId,
              comments: threadComments,
              moreCommentsCount: 0,
              type: 'commentGroup',
            }}
            authors={Object.fromEntries(
              threadAuthorIds
                .map((id, index) => [id, commentAuthors[index].data])
                .filter(([id, v]) => !!v),
            )}
            renderCommentContent={renderCommentContent}
            rootReplyCommentId={null}
            highlightLastComment
          />
        ) : (
          <EmptyDiscussions docId={docId} commentId={commentId} />
        )
      ) : null}

      <FocusedCommentReplies
        defaultOpen={!isReplying}
        docId={docId}
        commentId={commentId}
      />
    </AccessoryContent>
  )
}

function FocusedCommentReplies({
  defaultOpen,
  docId,
  commentId,
}: {
  defaultOpen: boolean
  docId: UnpackedHypermediaId
  commentId: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const comments = useAllDocumentComments(docId)
  useEffect(() => {
    setIsOpen(defaultOpen)
  }, [commentId, defaultOpen])
  const replies = useCommentGroups(comments.data, commentId)
  const commentAuthors = useCommentGroupAuthors(replies.data)
  if (!replies) return null
  if (replies.data.length == 0) return null
  if (!isOpen)
    return (
      <Button onPress={() => setIsOpen(true)} size="$1">
        <SizableText size="xs">{`Show ${replies.data.length} ${pluralS(
          replies.data.length,
          'Reply',
          'Replies',
        )}`}</SizableText>
      </Button>
    )
  return (
    <YStack>
      {replies.data.length > 0 ? (
        replies.data.map((r) => {
          return (
            <CommentGroup
              key={r.id}
              commentGroup={r}
              renderCommentContent={renderCommentContent}
              rootReplyCommentId={null}
              authors={commentAuthors}
            />
          )
        })
      ) : (
        <EmptyDiscussions docId={docId} commentId={commentId} />
      )}
    </YStack>
  )
}

function EmptyDiscussions({
  docId,
  commentId,
}: {
  docId: UnpackedHypermediaId
  commentId?: string
}) {
  return (
    <YStack alignItems="center" gap="$4" paddingVertical="$4">
      <MessageSquareOff size={48} color="$color8" />
      <SizableText size="md">No discussions</SizableText>
      <Button
        size="$3"
        onPress={() => triggerCommentDraftFocus(docId.id, commentId)}
        bg="$brand5"
        color="white"
        hoverStyle={{bg: '$brand4'}}
        focusStyle={{bg: '$brand4'}}
      >
        Start a discussion
      </Button>
    </YStack>
  )
}
