import {useDocumentCommentGroups} from '@/models/comments'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {CommentGroup} from '@shm/ui/discussion'
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
  openComment,
  docId,
}: {
  onClose?: () => void
  openComment?: string
  docId: UnpackedHypermediaId
}) {
  if (openComment) {
    return (
      <AccessoryContainer title="Comment..." onClose={onClose}>
        <SizableText>{openComment}</SizableText>
      </AccessoryContainer>
    )
  }
  return (
    <AccessoryContainer
      title="Comments"
      onClose={onClose}
      footer={
        <View padding="$3">
          <CommentDraft docId={docId} backgroundColor="$color1" />
        </View>
      }
    >
      <AllComments docId={docId} />
    </AccessoryContainer>
  )
}

function AllComments({docId}: {docId: UnpackedHypermediaId}) {
  const commentGroups = useDocumentCommentGroups(docId)

  const authors = useCommentGroupAuthors(commentGroups.data)
  console.log('~~~ AllComments', {comments: commentGroups.data, authors, docId})

  return (
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
  )
}
