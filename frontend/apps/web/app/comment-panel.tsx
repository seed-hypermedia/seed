import {
  HMComment,
  UnpackedHypermediaId,
  useUniversalAppContext,
} from '@shm/shared'
import {Comment} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {useCallback} from 'react'
import {SizableText, YStack} from 'tamagui'
import {CommentReplies, CommentRepliesEditor} from './comment-rendering'
import {WebDocContentProvider} from './doc-content-provider'

export function OpenCommentPanel({
  comment,
  docId,
  siteHost,
  enableWebSigning = false,
}: {
  comment: HMComment
  docId: UnpackedHypermediaId
  siteHost?: string
  enableWebSigning?: boolean
}) {
  const {originHomeId} = useUniversalAppContext()
  if (!originHomeId)
    throw new Error(
      'originHomeId is required in universalAppContext for OpenCommentPanel',
    )
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        <WebDocContentProvider
          key={comment.id}
          originHomeId={originHomeId}
          id={docId}
          siteHost={siteHost}
          comment={true}
        >
          <BlocksContent blocks={comment.content} parentBlockId={null} />
        </WebDocContentProvider>
      )
    },
    [originHomeId],
  )
  return (
    <YStack
      f={1}
      borderLeftWidth={1}
      borderLeftColor="$border"
      minWidth={300}
      position="absolute"
      right={0}
      top={80}
      bottom={0}
    >
      <Comment
        comment={comment}
        renderCommentContent={renderCommentContent}
        docId={docId}
        authorMetadata={{}} // todo
        rootReplyCommentId={null}
        isLast
        enableWebSigning={enableWebSigning}
        CommentReplies={CommentReplies}
        RepliesEditor={CommentRepliesEditor}
        enableReplies
        replyCount={111} // todo
        defaultExpandReplies
      />
      {/* <CommentGroup
        docId={docId}
        commentGroup={{
          comments: [comment],
          moreCommentsCount: 0,
          id: comment.id,
          type: 'commentGroup',
        }}
        //   isLastGroup={index === activityItems.length - 1}
        //   authors={activity.data?.accountsMetadata}
        renderCommentContent={renderCommentContent}
        CommentReplies={CommentReplies}
        //   homeId={originHomeId}
        rootReplyCommentId={null}
        siteHost={siteHost}
        //   enableReplies={enableReplies}
        enableReplies={true}
        RepliesEditor={CommentRepliesEditor}
        //   enableWebSigning={enableWebSigning}
        enableWebSigning={true}
      /> */}
    </YStack>
  )
}

export function BlockCommentsPanel({
  blockRef,
  docId,
}: {
  blockRef: string
  docId: UnpackedHypermediaId
}) {
  return (
    <YStack
      f={1}
      backgroundColor="salmon"
      minWidth={200}
      position="absolute"
      right={0}
      top={80}
      bottom={0}
    >
      <SizableText>COMMENT</SizableText>
    </YStack>
  )
}
