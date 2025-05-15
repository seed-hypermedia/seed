import {
  HMAccountsMetadata,
  HMCitationsPayload,
  HMComment,
  HMCommentCitation,
  HMCommentsPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Comment, CommentGroup, QuotedDocBlock} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {useIsDark} from '@shm/ui/use-is-dark'
import {MessageSquareOff, X} from '@tamagui/lucide-icons'
import {useCallback, useMemo} from 'react'
import {Button, SizableText, XStack, YStack} from 'tamagui'
import {EmptyDiscussions} from './commenting'
import {redirectToWebIdentityCommenting} from './commenting-utils'
import {WebDocContentProvider} from './doc-content-provider'
import {useDiscussion} from './models'

type DiscussionsPanelProps = {
  docId: UnpackedHypermediaId
  homeId: UnpackedHypermediaId
  document?: any
  originHomeId?: UnpackedHypermediaId
  siteHost?: string
  setBlockId: (blockId: string | null) => void
  comments?: HMCommentsPayload
  citations?: HMCitationsPayload
  enableWebSigning: boolean
  commentId?: string
  rootReplyCommentId?: string
  blockId?: string
  handleBack: () => void
  handleClose: () => void
  handleStartDiscussion?: () => void
}

export function WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {homeId, commentId, blockId, siteHost, handleBack, handleClose} = props

  const isDark = useIsDark()

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

  if (blockId) {
    content = (
      <BlockDiscussions
        {...props}
        isDark={isDark}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  if (commentId) {
    content = (
      <CommentDiscussions
        {...props}
        isDark={isDark}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  let content = (
    <AllDiscussions
      {...props}
      isDark={isDark}
      renderCommentContent={renderCommentContent}
    />
  )

  return (
    <YStack gap="$4">
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$3"
        alignItems="center"
        position="sticky"
        top={0}
        zIndex="$zIndex.8"
        h={56}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        bg={isDark ? '$background' : '$backgroundStrong'}
        justifyContent="space-between"
      >
        <SizableText size="$3" fontWeight="bold">
          Discussions
        </SizableText>
        <Button alignSelf="center" icon={X} chromeless onPress={handleClose} />
      </XStack>
      <YStack gap="$2">
        {commentId || blockId ? (
          <AccessoryBackButton onPress={handleBack} label="All Discussions" />
        ) : null}
      </YStack>
      {content}
    </YStack>
  )
}

export function AllDiscussions({
  docId,
  homeId,
  commentId,
  blockId,
  comments,
  siteHost,
  handleBack,
  handleClose,
  enableWebSigning,
  rootReplyCommentId,
  handleStartDiscussion,
  isDark = false,
  renderCommentContent,
}: DiscussionsPanelProps & {
  isDark?: boolean
  renderCommentContent: (comment: HMComment) => React.ReactNode
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

  return (
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
        {commentGroups?.length > 0 ? (
          commentGroups?.map((cg, idx) => {
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
          })
        ) : (
          <EmptyDiscussions
            onStartDiscussion={handleStartDiscussion}
            enableWebSigning={enableWebSigning}
            docId={docId}
            commentId={commentId}
            rootReplyCommentId={rootReplyCommentId}
          />
        )}
      </YStack>
    </YStack>
  )
}

function BlockDiscussions({
  docId,
  blockId,
  document,
  siteHost,
  originHomeId,
  citations,
  handleStartDiscussion,
  renderCommentContent,
  enableWebSigning,
}: DiscussionsPanelProps & {
  isDark?: boolean
  renderCommentContent: (comment: HMComment) => React.ReactNode
}) {
  if (!blockId) return null
  const citationsForBlock = citations?.filter((citation) => {
    return (
      citation.targetFragment?.blockId === blockId &&
      citation.source.type === 'c'
    )
  }) as (HMCommentCitation | null)[]

  return (
    <YStack gap="$4">
      <WebDocContentProvider
        key={blockId}
        originHomeId={originHomeId}
        siteHost={siteHost}
      >
        <QuotedDocBlock docId={docId} blockId={blockId} />
      </WebDocContentProvider>
      <YStack>
        {citationsForBlock?.length > 0 ? (
          citationsForBlock.map(
            (citation) =>
              citation?.comment && (
                <Comment
                  isLast={true}
                  comment={citation.comment}
                  rootReplyCommentId={null}
                  renderCommentContent={renderCommentContent}
                  authorMetadata={citation.author?.metadata}
                />
              ),
          )
        ) : (
          <EmptyDiscussions
            onStartDiscussion={handleStartDiscussion}
            enableWebSigning={enableWebSigning}
            docId={docId}
          />
        )}
      </YStack>
    </YStack>
  )
}

function CommentDiscussions(
  props: DiscussionsPanelProps & {
    isDark?: boolean
    renderCommentContent: (comment: HMComment) => React.ReactNode
  },
) {
  const {
    commentId,
    docId,
    homeId,
    siteHost,
    handleBack,
    handleClose,
    comments,
    enableWebSigning,
    rootReplyCommentId,
    handleStartDiscussion,
    isDark,
    renderCommentContent,
  } = props

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

  return (
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
        {commentGroups?.length > 0
          ? commentGroups?.map((cg, idx) => {
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
            })
          : null}
      </YStack>
    </YStack>
  )
}

export function EmptyDiscussions({
  docId,
  commentId,
  rootReplyCommentId,
  enableWebSigning,
  onStartDiscussion,
}: {
  docId: UnpackedHypermediaId
  commentId?: string
  rootReplyCommentId?: string
  enableWebSigning: boolean
  onStartDiscussion?: () => void
}) {
  return (
    <YStack alignItems="center" gap="$4" paddingVertical="$4">
      <MessageSquareOff size={48} color="$color8" />
      <SizableText size="$3">No discussions</SizableText>
      <Button
        size="$3"
        onPress={() => {
          if (enableWebSigning) {
            onStartDiscussion?.()
          } else {
            redirectToWebIdentityCommenting(
              docId,
              commentId || null,
              rootReplyCommentId || null,
            )
          }
        }}
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
