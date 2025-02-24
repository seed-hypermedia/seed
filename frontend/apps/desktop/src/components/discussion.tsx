import {useDocumentCommentGroups} from '@/models/comments'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {CommentGroup} from '@shm/ui/discussion'
import {EmptyDiscussion} from '@shm/ui/icons'
import {SizableText, useTheme, YStack} from 'tamagui'
import {
  CommentDraft,
  CommentReplies,
  renderCommentContent,
  RepliesEditor,
  useCommentGroupAuthors,
} from './commenting'

export function Discussion({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <YStack paddingVertical="$6" marginBottom={100} gap="$4">
      <SizableText fontSize={20} fontWeight="600">
        Discussions
      </SizableText>
      <CommentDraft docId={docId} />
      <DiscussionComments docId={docId} />
    </YStack>
  )
}

function DiscussionComments({docId}: {docId: UnpackedHypermediaId}) {
  const comments = useDocumentCommentGroups(docId)
  const authors = useCommentGroupAuthors(comments.data)
  const theme = useTheme()
  if (comments.data.length == 0) {
    return (
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <EmptyDiscussion color={theme.color6.val} />
        <SizableText color="$color7" fontWeight="500" size="$5">
          There are no active discussions
        </SizableText>
      </YStack>
    )
  }
  return comments.data.map((commentGroup) => {
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
