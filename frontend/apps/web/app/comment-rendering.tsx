import {useDiscussion} from '@/models'
import {HMComment, UnpackedHypermediaId} from '@shm/shared'
import {CommentGroup} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {useCallback} from 'react'
import {YStack} from 'tamagui'
import {WebCommenting} from './client-lazy'
import {WebDocContentProvider} from './doc-content-provider'

export function CommentReplies({
  docId,
  homeId,
  siteHost,
  replyCommentId,
  rootReplyCommentId,
  enableReplies = true,
  enableWebSigning = false,
}: {
  docId: UnpackedHypermediaId
  homeId?: UnpackedHypermediaId
  siteHost?: string | undefined
  replyCommentId: string
  rootReplyCommentId: string | null
  enableReplies?: boolean
  enableWebSigning?: boolean
}) {
  const discussion = useDiscussion(docId, replyCommentId)
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        homeId && (
          <WebDocContentProvider
            key={comment.id}
            originHomeId={homeId}
            siteHost={siteHost}
            comment={true}
          >
            <BlocksContent blocks={comment.content} parentBlockId={null} />
          </WebDocContentProvider>
        )
      )
    },
    [homeId],
  )
  if (!discussion.data) return null
  const {commentGroups, commentAuthors} = discussion.data
  if (!commentGroups) return null
  return (
    <YStack paddingLeft={22}>
      {commentGroups.map((commentGroup) => {
        return (
          <CommentGroup
            isNested
            key={commentGroup.id}
            docId={docId}
            authors={commentAuthors}
            renderCommentContent={renderCommentContent}
            commentGroup={commentGroup}
            isLastGroup={commentGroup === commentGroups.at(-1)}
            CommentReplies={CommentReplies}
            homeId={homeId}
            siteHost={siteHost}
            enableReplies={enableReplies}
            RepliesEditor={enableReplies ? CommentRepliesEditor : undefined}
            rootReplyCommentId={rootReplyCommentId}
            enableWebSigning={enableWebSigning}
          />
        )
      })}
    </YStack>
  )
}

export function CommentRepliesEditor({
  isReplying,
  docId,
  replyCommentId,
  rootReplyCommentId,
  onDiscardDraft,
  onReplied,
  enableWebSigning,
}: {
  isReplying: boolean
  docId: UnpackedHypermediaId
  replyCommentId: string
  rootReplyCommentId: string
  onDiscardDraft: () => void
  onReplied: () => void
  enableWebSigning: boolean
}) {
  if (!isReplying) return null
  return (
    <WebCommenting
      docId={docId}
      replyCommentId={replyCommentId}
      rootReplyCommentId={rootReplyCommentId}
      onDiscardDraft={onDiscardDraft}
      onReplied={onReplied}
      enableWebSigning={enableWebSigning}
    />
  )
}
