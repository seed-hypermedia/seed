import {
  HMAccountsMetadata,
  HMCitationsPayload,
  HMComment,
  HMCommentCitation,
  HMCommentsPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Comment, CommentGroup, QuotedDocBlock} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {useIsDark} from '@shm/ui/use-is-dark'
import {MessageSquareOff, X} from '@tamagui/lucide-icons'
import React, {useCallback, useMemo} from 'react'
import {Button, SizableText, XStack, YStack} from 'tamagui'
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

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel)

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
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

  let content = (
    <AllDiscussions
      {...props}
      isDark={isDark}
      renderCommentContent={renderCommentContent}
    />
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
        <Button
          alignSelf="center"
          display="none"
          $gtSm={{display: 'flex'}}
          icon={X}
          chromeless
          onPress={handleClose}
        />
      </XStack>
      <YStack gap="$2" paddingHorizontal="$2">
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

  commentId,

  comments,
  enableWebSigning,
  rootReplyCommentId,
  handleStartDiscussion,
  renderCommentContent,
}: DiscussionsPanelProps & {
  isDark?: boolean
  renderCommentContent: (comment: HMComment) => React.ReactNode
}) {
  const commentGroups = comments?.commentGroups || []

  return (
    <YStack gap="$4" paddingHorizontal="$2">
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
                commentGroup={cg}
                authors={comments?.commentAuthors}
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
  )
}

function BlockDiscussions({
  docId,
  blockId,
  document,
  siteHost,
  originHomeId,
  citations,
  comments,
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
    <YStack gap="$4" paddingHorizontal="$2">
      <YStack padding="$3" borderRadius="$3">
        <WebDocContentProvider
          key={blockId}
          originHomeId={originHomeId}
          siteHost={siteHost}
        >
          <QuotedDocBlock docId={docId} blockId={blockId} />
        </WebDocContentProvider>
      </YStack>
      <YStack>
        {citationsForBlock?.length > 0 ? (
          citationsForBlock.map(
            (citation) =>
              citation?.comment && (
                <CommentCitationEntry
                  key={citation.source.id.id}
                  citation={citation}
                  accounts={comments?.commentAuthors || {}}
                  renderCommentContent={renderCommentContent}
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
  const {commentId, docId, comments, renderCommentContent} = props

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
    <YStack gap="$4" paddingHorizontal="$2">
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

export function CommentCitationEntry({
  citation,
  accounts,
  renderCommentContent,
}: {
  citation: HMCommentCitation
  accounts: HMAccountsMetadata
  renderCommentContent: (comment: HMComment) => React.ReactNode
}) {
  const citationTargetFragment = citation.targetFragment
  const citationTarget = citation.targetId
  const comment = citation.comment
  const focusedComment = useMemo(() => {
    if (!comment) return comment
    if (
      comment.content.length === 1 &&
      comment.content[0].block.type === 'Embed' &&
      citationTarget
    ) {
      const firstBlockNode = comment.content[0]
      const singleEmbedId = unpackHmId(firstBlockNode.block.link)
      if (
        firstBlockNode.children?.length &&
        singleEmbedId?.type === citationTarget.type &&
        singleEmbedId.id === citationTarget.id &&
        singleEmbedId.blockRef === citationTargetFragment?.blockId
      ) {
        return {
          ...comment,
          content: firstBlockNode.children,
        } satisfies HMComment
      }
    }
    return comment
  }, [comment, citationTargetFragment, citationTarget])
  const docId = comment
    ? hmId('d', comment.targetAccount, {
        path: entityQueryPathToHmIdPath(comment.targetPath || ''),
        version: comment.targetVersion,
      })
    : undefined
  // const replies = useCommentReplies(citation.source.id.uid, docId)

  if (!comment || !docId) return null
  if (!focusedComment) return null
  return (
    <Comment
      isLast={false}
      key={comment.id}
      authorId={comment.author}
      comment={focusedComment}
      rootReplyCommentId={comment.threadRoot ?? null}
      authorMetadata={accounts[comment.author]?.metadata}
      renderCommentContent={renderCommentContent}
      // replyCount={replies?.length}
    />
  )
}
