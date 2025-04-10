import {useEntityCitations} from '@/models/citations'
import {useComment, useDocumentCommentGroups} from '@/models/comments'
import {
  DocumentCommentsAccessory,
  entityQueryPathToHmIdPath,
  hmId,
  pluralS,
} from '@shm/shared'
import {HMCitation, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {Comment, CommentGroup} from '@shm/ui/discussion'
import {ArrowLeft} from '@tamagui/lucide-icons'
import {YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {memo} from 'react'
import {View} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'
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

function AccessoryBackButton({onPress}: {onPress: () => void}) {
  return (
    <Button onPress={onPress}>
      <ArrowLeft />
      <SizableText>All Comments</SizableText>
    </Button>
  )
}

function AllComments({docId}: {docId: UnpackedHypermediaId}) {
  const commentGroups = useDocumentCommentGroups(docId)

  const authors = useCommentGroupAuthors(commentGroups.data)
  console.log('~~~ AllComments', {comments: commentGroups.data, authors, docId})

  return (
    <AccessoryContainer
      title={`${commentGroups.data?.length} ${pluralS(
        commentGroups.data?.length,
        'Comment',
      )}`}
      footer={
        <View padding="$3">
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
  return (
    <AccessoryContainer
      title={`Comment on Block ${blockId}`}
      footer={
        <View padding="$3">
          <CommentDraft docId={docId} backgroundColor="$color1" />
        </View>
      }
    >
      <AccessoryBackButton onPress={onBack} />
      {citationsForBlock?.map((citation) => {
        return <CitationEntry citation={citation} key={citation.source.id} />
      })}
    </AccessoryContainer>
  )
}

function CitationEntry({citation}: {citation: HMCitation}) {
  if (citation.source.type === 'c') {
    return <CommentCitation citation={citation} />
  }
  return <SizableText>Unsupported Citation Type</SizableText>
}

function CommentCitation({citation}: {citation: HMCitation}) {
  const comment = useComment(citation.source)
  if (!comment.data) return null
  const docId = hmId('d', comment.data.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.data.targetPath),
    version: comment.data.targetVersion,
  })
  return (
    <Comment
      isFirst={false}
      isLast={false}
      isNested={false}
      key={comment.data.id}
      docId={docId}
      comment={comment.data}
      rootReplyCommentId={comment.data.threadRoot}
      authorMetadata={{}}
      renderCommentContent={renderCommentContent}
      replyCount={
        9 // todo
        // isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
      }
      enableWebSigning={true}
      RepliesEditor={RepliesEditor}
      CommentReplies={CommentReplies}
      // enableReplies={enableReplies}
      // homeId={homeId}
      // siteHost={siteHost}
    />
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
  return (
    <AccessoryContainer title="Reply to Comment">
      <AccessoryBackButton onPress={onBack} />
      <SizableText>{commentId}</SizableText>
    </AccessoryContainer>
  )
}
