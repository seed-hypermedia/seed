import {WEB_IDENTITY_ENABLED} from '@shm/shared'
import {
  HMComment,
  HMCommentsPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {CommentGroup} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {useCallback, useMemo, useState} from 'react'
import {SizableText, XStack, YStack} from 'tamagui'
import {CommentReplies, CommentRepliesEditor} from './comment-rendering'
import {redirectToWebIdentityCommenting} from './commenting-utils'
import {WebDocContentProvider} from './doc-content-provider'
import {useDiscussion} from './models'

export function WebCommentsPanel({
  docId,
  homeId,
  blockId,
  setBlockId,
  comments,
  document,
  originHomeId,
  siteHost,
  enableWebSigning,
}: {
  docId: UnpackedHypermediaId
  homeId: UnpackedHypermediaId
  blockId?: string | null
  document?: any
  originHomeId?: UnpackedHypermediaId
  siteHost?: string
  setBlockId: (blockId: string | null) => void
  comments?: HMCommentsPayload
  enableWebSigning: boolean
}) {
  const [focusedCommentId, setFocusedCommentId] = useState<string | undefined>(
    undefined,
  )
  const focusedComments = useDiscussion(docId, focusedCommentId)

  const commentGroups = useMemo(() => {
    if (!focusedCommentId) return comments?.commentGroups || []
    return focusedComments?.data?.commentGroups || []
  }, [focusedCommentId, focusedComments, comments])

  const focusedComment = useMemo(() => {
    if (!focusedCommentId) return null
    return comments?.allComments.find((c) => c.id === focusedCommentId)
  }, [focusedCommentId, focusedComments])

  const commentAuthors = useMemo(() => {
    if (!focusedCommentId) return comments?.commentAuthors || {}
    return {
      ...(comments?.commentAuthors || {}),
      ...(focusedComments?.data?.commentAuthors || {}),
    }
  }, [focusedCommentId, focusedComments, comments])

  const parentThread = useMemo(() => {
    if (!focusedCommentId) return null
    let selectedComment: HMComment | null = focusedComment || null
    if (!selectedComment) return null

    const parentThread = [selectedComment]
    while (selectedComment?.replyParent) {
      const parentComment =
        comments?.allComments?.find(
          (c) => c.id === selectedComment!.replyParent,
        ) || null

      if (!parentComment) {
        break
      }
      parentThread.unshift(parentComment)
      selectedComment = parentComment
    }
    return parentThread
  }, [focusedCommentId, focusedComment, comments])

  const rootCommentId = parentThread?.at(0)?.id

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
            <BlocksContent
              hideCollapseButtons
              blocks={comment.content}
              parentBlockId={null}
            />
          </WebDocContentProvider>
        )
      )
    },
    [homeId],
  )

  function onReplyClick(replyCommentId: string, rootReplyCommentId: string) {
    redirectToWebIdentityCommenting(docId, replyCommentId, rootReplyCommentId)
  }

  function onReplyCountClick(commentId: string) {
    setFocusedCommentId(commentId)
  }

  return (
    <YStack gap="$4">
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$3"
        alignItems="center"
        h={57}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
      >
        <SizableText size="$3" fontWeight="bold">
          Discussions
        </SizableText>
      </XStack>
      <YStack gap="$2" paddingHorizontal="$3">
        {focusedCommentId ? (
          <AccessoryBackButton
            onPress={() => setFocusedCommentId(undefined)}
            label="All Discussions"
          />
        ) : null}
        <YStack gap="$4">
          {rootCommentId && parentThread ? (
            <YStack padding="$3" borderRadius="$3">
              <CommentGroup
                docId={docId}
                commentGroup={{
                  id: rootCommentId,
                  comments: parentThread,
                  moreCommentsCount: 0,
                  type: 'commentGroup',
                }}
                isLastGroup
                authors={commentAuthors as any}
                renderCommentContent={renderCommentContent}
                rootReplyCommentId={null}
                highlightLastComment
                enableReplies
                enableWebSigning={enableWebSigning}
                onReplyClick={
                  !enableWebSigning && WEB_IDENTITY_ENABLED
                    ? onReplyClick
                    : undefined
                }
                onReplyCountClick={onReplyCountClick}
              />
            </YStack>
          ) : null}
          <YStack>
            {commentGroups?.map((cg, idx) => {
              return (
                <YStack
                  key={cg.id}
                  paddingHorizontal="$3"
                  marginBottom={commentGroups.length - 1 > idx ? '$4' : 0}
                  borderBottomWidth={1}
                  borderBottomColor="$borderColor"
                >
                  <CommentGroup
                    key={cg.id}
                    commentGroup={cg}
                    docId={docId}
                    authors={commentAuthors as any}
                    renderCommentContent={renderCommentContent}
                    isLastGroup={cg === commentGroups.at(-1)}
                    CommentReplies={CommentReplies}
                    homeId={homeId}
                    siteHost={siteHost}
                    enableReplies
                    RepliesEditor={CommentRepliesEditor}
                    enableWebSigning={enableWebSigning}
                    onReplyClick={
                      !enableWebSigning && WEB_IDENTITY_ENABLED
                        ? onReplyClick
                        : undefined
                    }
                    onReplyCountClick={onReplyCountClick}
                    rootReplyCommentId={null}
                  />
                </YStack>
              )
            })}
          </YStack>
        </YStack>
      </YStack>
    </YStack>
  )
}
