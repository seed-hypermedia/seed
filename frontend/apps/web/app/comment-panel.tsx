import {
  HMAccountsMetadata,
  HMComment,
  HMCommentsPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {CommentGroup} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {useCallback, useMemo} from 'react'
import {SizableText, XStack, YStack} from 'tamagui'
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
  commentId,
  rootReplyCommentId,
  handleBack,
}: {
  docId: UnpackedHypermediaId
  homeId: UnpackedHypermediaId
  document?: any
  originHomeId?: UnpackedHypermediaId
  siteHost?: string
  setBlockId: (blockId: string | null) => void
  comments?: HMCommentsPayload
  enableWebSigning: boolean
  commentId?: string
  rootReplyCommentId?: string
  blockId?: string
  handleBack: () => void
}) {
  const focusedComments = useDiscussion(docId, commentId)
  const commentGroups = useMemo(() => {
    if (!commentId) return comments?.commentGroups || []
    return focusedComments?.data?.commentGroups || []
  }, [commentId, focusedComments, comments])

  const focusedComment =
    comments?.allComments.find((c) => c.id === commentId) || null

  const commentAuthors: HMAccountsMetadata = useMemo(() => {
    return {
      ...(comments?.commentAuthors || {}),
      ...(focusedComments?.data?.commentAuthors || {}),
    }
  }, [commentId, focusedComments?.data, comments])

  const parentThread = useMemo(() => {
    if (!commentId) return null
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
  }, [commentId, focusedComment, comments])

  const rootCommentId = parentThread?.at(0)?.id

  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        homeId && (
          <WebDocContentProvider
            key={comment.id}
            originHomeId={homeId}
            siteHost={siteHost}
            comment
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

  return (
    <YStack gap="$4" bg="red">
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$3"
        alignItems="center"
        h={56}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
      >
        <SizableText size="$3" fontWeight="bold">
          Discussions
        </SizableText>
      </XStack>
      <YStack gap="$2" paddingHorizontal="$3">
        {commentId || blockId ? (
          <AccessoryBackButton onPress={handleBack} label="All Discussions" />
        ) : null}
        <YStack gap="$4">
          {rootCommentId && parentThread ? (
            <YStack padding="$3" borderRadius="$3">
              <CommentGroup
                commentGroup={{
                  id: rootCommentId,
                  comments: parentThread,
                  moreCommentsCount: 0,
                  type: 'commentGroup',
                }}
                authors={commentAuthors}
                renderCommentContent={renderCommentContent}
                rootReplyCommentId={null}
                highlightLastComment
                enableReplies
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
                    authors={commentAuthors as any}
                    renderCommentContent={renderCommentContent}
                    enableReplies
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
