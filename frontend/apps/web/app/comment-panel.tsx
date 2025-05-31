import {
  HMAccountsMetadata,
  HMComment,
  HMCommentCitation,
  HMDocument,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Comment, CommentGroup, QuotedDocBlock} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {Spinner} from '@shm/ui/spinner'
import {useIsDark} from '@shm/ui/use-is-dark'
import {MessageSquareOff, X} from '@tamagui/lucide-icons'
import React, {useCallback, useMemo} from 'react'
import {Button, SizableText, XStack, YStack} from 'tamagui'

import {redirectToWebIdentityCommenting} from './commenting-utils'
import {WebDocContentProvider} from './doc-content-provider'
import {useAllDiscussions, useBlockDiscussions, useDiscussion} from './models'

type DiscussionsPanelProps = {
  docId: UnpackedHypermediaId
  homeId: UnpackedHypermediaId
  document?: HMDocument
  originHomeId?: UnpackedHypermediaId
  siteHost?: string
  setBlockId: (blockId: string | null) => void
  enableWebSigning: boolean
  commentId?: string
  rootReplyCommentId?: string
  blockId?: string
  handleBack: () => void
  handleClose: () => void
  handleStartDiscussion?: () => void
  activitySummary?: React.ReactNode
}

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel)

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {
    homeId,
    commentId,
    blockId,
    siteHost,
    handleBack,
    handleClose,
    activitySummary = null,
  } = props

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
      <CommentDiscussion
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
        bg={'$backgroundStrong'}
        justifyContent="space-between"
      >
        <p className="text-md font-bold">Discussions</p>
        {activitySummary}
        <Button
          alignSelf="center"
          display="none"
          size="$3"
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
  enableWebSigning,
  rootReplyCommentId,
  handleStartDiscussion,
  renderCommentContent,
}: DiscussionsPanelProps & {
  isDark?: boolean
  renderCommentContent: (comment: HMComment) => React.ReactNode
}) {
  const allDiscussions = useAllDiscussions(docId)
  const commentGroups = allDiscussions?.data?.commentGroups || []
  let panelContent = null
  if (allDiscussions.isLoading && !allDiscussions.data) {
    panelContent = (
      <div className="flex justify-center items-center">
        <Spinner />
      </div>
    )
  } else if (allDiscussions.data) {
    panelContent =
      commentGroups?.length > 0 ? (
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
                authors={allDiscussions?.data?.authors}
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
      )
  }
  return (
    <YStack gap="$4" paddingHorizontal="$2">
      {panelContent}
    </YStack>
  )
}

function BlockDiscussions({
  docId,
  blockId,
  document,
  siteHost,
  originHomeId,
  handleStartDiscussion,
  renderCommentContent,
  enableWebSigning,
}: DiscussionsPanelProps & {
  isDark?: boolean
  renderCommentContent: (comment: HMComment) => React.ReactNode
}) {
  if (!blockId) throw new Error('Block ID is required in BlockDiscussions')
  const blockDiscussions = useBlockDiscussions(docId, blockId)
  let panelContent = null
  if (blockDiscussions.isLoading && blockDiscussions.data) {
    panelContent = <Spinner />
  } else if (blockDiscussions.data) {
    panelContent =
      blockDiscussions.data.citingComments.length > 0 ? (
        blockDiscussions.data.citingComments.map(
          (citation) =>
            citation?.comment && (
              <CommentCitationEntry
                key={citation.source.id.id}
                citation={citation}
                accounts={blockDiscussions.data.authors}
                renderCommentContent={renderCommentContent}
              />
            ),
        )
      ) : (
        <EmptyDiscussions
          onStartDiscussion={handleStartDiscussion}
          enableWebSigning={enableWebSigning}
          docId={docId}
          quotingBlockId={blockId}
        />
      )
  }
  return (
    <YStack gap="$4" paddingHorizontal="$2">
      <YStack padding="$3" borderRadius="$3">
        <WebDocContentProvider
          key={blockId}
          originHomeId={originHomeId}
          siteHost={siteHost}
        >
          <QuotedDocBlock docId={docId} blockId={blockId} doc={document!} />
        </WebDocContentProvider>
      </YStack>
      <YStack>{panelContent}</YStack>
    </YStack>
  )
}

function CommentDiscussion(
  props: DiscussionsPanelProps & {
    isDark?: boolean
    renderCommentContent: (comment: HMComment) => React.ReactNode
  },
) {
  const {commentId, docId, renderCommentContent} = props

  const discussion = useDiscussion(docId, commentId)

  if (!discussion.data) return null
  const {thread, authors, commentGroups} = discussion.data

  const rootCommentId = thread?.at(0)?.id

  let panelContent = null
  if (discussion.isInitialLoading) {
    panelContent = <Spinner />
  } else if (discussion.data) {
    panelContent =
      commentGroups?.length > 0
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
                  authors={authors}
                  renderCommentContent={renderCommentContent}
                  enableReplies
                  rootReplyCommentId={null}
                />
              </YStack>
            )
          })
        : null
  }

  return (
    <YStack gap="$4" paddingHorizontal="$2">
      {rootCommentId && thread ? (
        <YStack padding="$3" borderRadius="$3">
          <CommentGroup
            commentGroup={{
              id: rootCommentId,
              comments: thread,
              moreCommentsCount: 0,
              type: 'commentGroup',
            }}
            authors={authors}
            renderCommentContent={renderCommentContent}
            rootReplyCommentId={null}
            highlightLastComment
            enableReplies
          />
        </YStack>
      ) : null}
      <YStack>{panelContent}</YStack>
    </YStack>
  )
}

export function EmptyDiscussions({
  docId,
  commentId,
  rootReplyCommentId,
  enableWebSigning,
  onStartDiscussion,
  quotingBlockId,
}: {
  docId: UnpackedHypermediaId
  commentId?: string
  rootReplyCommentId?: string
  enableWebSigning: boolean
  onStartDiscussion?: () => void
  quotingBlockId?: string
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
            redirectToWebIdentityCommenting(docId, {
              replyCommentId: commentId,
              rootReplyCommentId,
              quotingBlockId,
            })
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
