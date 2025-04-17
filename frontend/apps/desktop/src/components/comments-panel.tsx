import {useEntityCitations} from '@/models/citations'
import {
  useAllDocumentComments,
  useComment,
  useDocumentCommentGroups,
} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {DocumentCommentsAccessory, hmId, pluralS} from '@shm/shared'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Comment, CommentGroup} from '@shm/ui/discussion'
import {BlocksContent, getBlockNodeById} from '@shm/ui/document-content'
import {CitationsIcon} from '@shm/ui/icons'
import {YStack} from '@tamagui/stacks'
import {memo, useMemo} from 'react'
import {Spinner, View, XStack} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'
import {CommentCitationEntry} from './citations-panel'
import {
  CommentDraft,
  CommentReplies,
  renderCommentContent,
  RepliesEditor,
  useCommentGroupAuthors,
} from './commenting'

export const CommentsPanel = memo(_CommentsPanel)

function _CommentsPanel({
  onClose,
  docId,
  onAccessory,
  accessory: {openComment, openBlockId, blockRange, autoFocus},
}: {
  onClose?: () => void
  docId: UnpackedHypermediaId
  accessory: DocumentCommentsAccessory
  onAccessory: (acc: DocumentCommentsAccessory) => void
}) {
  if (openComment) {
    return (
      <CommentReplyAccessory
        docId={docId}
        onBack={() => onAccessory({key: 'comments'})}
        commentId={openComment}
      />
    )
  }
  if (openBlockId) {
    return (
      <CommentBlockAccessory
        docId={docId}
        blockId={openBlockId}
        autoFocus={autoFocus}
        onBack={() => onAccessory({key: 'comments'})}
      />
    )
  }
  return <AllComments docId={docId} />
}

function AllComments({docId}: {docId: UnpackedHypermediaId}) {
  const commentGroups = useDocumentCommentGroups(docId)

  const authors = useCommentGroupAuthors(commentGroups.data)

  return (
    <AccessoryContainer
      title={`${commentGroups.data?.length} ${pluralS(
        commentGroups.data?.length,
        'Comment',
      )}`}
      footer={
        <View paddingVertical="$2">
          <CommentDraft docId={docId} backgroundColor="$color1" />
        </View>
      }
    >
      <YStack>
        {commentGroups.data?.map((cg) => {
          return (
            <YStack key={cg.id} paddingHorizontal="$1.5">
              <CommentGroup
                rootReplyCommentId={null}
                key={cg.id}
                docId={docId}
                commentGroup={cg}
                isLastGroup={cg === commentGroups.data?.at(-1)}
                authors={authors}
                renderCommentContent={renderCommentContent}
                RepliesEditor={RepliesEditor}
                CommentReplies={CommentReplies}
              />
            </YStack>
          )
        })}
      </YStack>
    </AccessoryContainer>
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
  const accounts = useAccountsMetadata(Array.from(accountIds))
  return (
    <AccessoryContainer
      title={`Comments`}
      footer={
        <View padding="$3">
          <CommentDraft
            docId={docId}
            backgroundColor="$color1"
            quotingBlockId={blockId}
          />
        </View>
      }
    >
      <AccessoryBackButton onPress={onBack} label="Block Comments" />
      <QuotedDocBlock docId={docId} blockId={blockId} />
      {citationsForBlock?.map((citation) => {
        return (
          <CommentCitationEntry
            citation={citation}
            key={citation.source.id.id}
            accounts={accounts}
          />
        )
      })}
    </AccessoryContainer>
  )
}

function QuotedDocBlock({
  docId,
  blockId,
}: {
  docId: UnpackedHypermediaId
  blockId: string
}) {
  const doc = useEntity(docId)
  const blockContent = useMemo(() => {
    if (!doc.data?.document?.content) return null
    return getBlockNodeById(doc.data?.document?.content, blockId)
  }, [doc.data?.document?.content, blockId])
  if (doc.isInitialLoading) {
    return <Spinner />
  }
  return (
    <XStack backgroundColor="$green3" borderRadius="$4" padding="$2">
      <CitationsIcon color="#000" size={40} />
      {blockContent && (
        <AppDocContentProvider>
          <BlocksContent blocks={[blockContent]} parentBlockId={blockId} />
        </AppDocContentProvider>
      )}
    </XStack>
  )
}

function CommentReplyAccessory({
  docId,
  onBack,
  commentId,
}: {
  docId: UnpackedHypermediaId
  onBack: () => void
  commentId: string
}) {
  const comment = useComment(hmId('c', commentId))
  const commentAuthor = useEntity(
    comment.data?.author ? hmId('d', comment.data?.author) : null,
  )
  const allComments = useAllDocumentComments(docId)
  const replyCount = useMemo(() => {
    return allComments.data?.filter((c) => c.replyParent === commentId).length
  }, [allComments.data, commentId])
  return (
    <AccessoryContainer
      title="Comment"
      footer={
        <View padding="$3">
          <CommentDraft
            docId={docId}
            backgroundColor="$color1"
            replyCommentId={commentId}
          />
        </View>
      }
    >
      <AccessoryBackButton onPress={onBack} />
      {comment.data ? (
        <Comment
          comment={comment.data}
          renderCommentContent={renderCommentContent}
          docId={docId}
          authorMetadata={commentAuthor.data?.document?.metadata}
          rootReplyCommentId={null}
          isLast
          enableWebSigning={false}
          CommentReplies={CommentReplies}
          RepliesEditor={RepliesEditor}
          enableReplies
          replyCount={replyCount}
          defaultExpandReplies
        />
      ) : (
        <Spinner />
      )}
    </AccessoryContainer>
  )
}
