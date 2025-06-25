import {
  HMAccountsMetadata,
  HMComment,
  HMCommentCitation,
  HMDocument,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {Button} from '@shm/ui/button'
import {Comment, CommentGroup, QuotedDocBlock} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useIsDark} from '@shm/ui/use-is-dark'
import {MessageSquareOff} from 'lucide-react'
import React, {useCallback, useMemo} from 'react'

import {useTxString} from '@shm/shared/translation'
import {cn} from '@shm/ui/utils'
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
  comment?: HMComment
  blockId?: string
  handleBack: () => void
  handleStartDiscussion?: () => void
}

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel)

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {homeId, comment, blockId, siteHost, handleBack} = props

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
    return (
      <BlockDiscussions
        {...props}
        isDark={isDark}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  if (comment) {
    return (
      <CommentDiscussion
        {...props}
        isDark={isDark}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  return (
    <AllDiscussions
      {...props}
      isDark={isDark}
      renderCommentContent={renderCommentContent}
    />
  )
}

export function AllDiscussions({
  docId,
  comment,
  enableWebSigning,
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
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  } else if (allDiscussions.data) {
    panelContent =
      commentGroups?.length > 0 ? (
        commentGroups?.map((cg, idx) => {
          return (
            <div
              key={cg.id}
              className={cn(
                'border-border border-b px-3',
                commentGroups.length - 1 > idx && 'mb-4',
              )}
            >
              <CommentGroup
                commentGroup={cg}
                authors={allDiscussions?.data?.authors}
                renderCommentContent={renderCommentContent}
                enableReplies
              />
            </div>
          )
        })
      ) : (
        <EmptyDiscussions
          onStartDiscussion={handleStartDiscussion}
          enableWebSigning={enableWebSigning}
          docId={docId}
          replyComment={comment}
        />
      )
  }
  return <div className="flex flex-col gap-4 px-2">{panelContent}</div>
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
    <div className="flex flex-col gap-4 px-2">
      <div className="rounded-md p-3">
        <WebDocContentProvider
          key={blockId}
          originHomeId={originHomeId}
          siteHost={siteHost}
        >
          <QuotedDocBlock docId={docId} blockId={blockId} doc={document!} />
        </WebDocContentProvider>
      </div>
      <div className="flex flex-col">{panelContent}</div>
    </div>
  )
}

function CommentDiscussion(
  props: DiscussionsPanelProps & {
    isDark?: boolean
    renderCommentContent: (comment: HMComment) => React.ReactNode
  },
) {
  const {comment, docId, renderCommentContent} = props

  const discussion = useDiscussion(docId, comment?.id)

  if (!discussion.data) return null
  const {thread, authors, commentGroups} = discussion.data

  const rootCommentId = thread?.at(0)?.id
  const rootCommentVersion = thread?.at(0)?.version

  let panelContent = null
  if (discussion.isInitialLoading) {
    panelContent = <Spinner />
  } else if (discussion.data) {
    panelContent =
      commentGroups?.length > 0
        ? commentGroups?.map((cg, idx) => {
            return (
              <div
                key={cg.id}
                className={cn(
                  'border-border border-b px-3',
                  commentGroups.length - 1 > idx && 'mb-4',
                )}
              >
                <CommentGroup
                  key={cg.id}
                  commentGroup={cg}
                  authors={authors}
                  renderCommentContent={renderCommentContent}
                  enableReplies
                />
              </div>
            )
          })
        : null
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {rootCommentId && thread ? (
        <div className="rounded-md p-3">
          <CommentGroup
            commentGroup={{
              id: rootCommentId,
              comments: thread,
              moreCommentsCount: 0,
              type: 'commentGroup',
            }}
            authors={authors}
            renderCommentContent={renderCommentContent}
            highlightLastComment
            enableReplies
          />
        </div>
      ) : null}
      <div className="flex flex-col">{panelContent}</div>
    </div>
  )
}

export function EmptyDiscussions({
  docId,
  replyComment,
  enableWebSigning,
  onStartDiscussion,
  quotingBlockId,
}: {
  docId: UnpackedHypermediaId
  replyComment?: HMComment
  enableWebSigning: boolean
  onStartDiscussion?: () => void
  quotingBlockId?: string
}) {
  const tx = useTxString()
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <MessageSquareOff className="size-25" size={48} color="$color8" />
      <SizableText size="md">{tx('No discussions')}</SizableText>
      <Button
        variant="brand"
        onClick={() => {
          if (enableWebSigning) {
            onStartDiscussion?.()
          } else {
            redirectToWebIdentityCommenting(docId, {
              replyCommentId: replyComment?.id,
              replyCommentVersion: replyComment?.version,
              rootReplyCommentVersion: replyComment?.threadRootVersion,
              quotingBlockId,
            })
          }
        }}
      >
        {tx('Start a Discussion')}
      </Button>
    </div>
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
      rootCommentId={comment.threadRoot ?? null}
      rootCommentVersion={comment.threadRootVersion ?? null}
      authorMetadata={accounts[comment.author]?.metadata}
      renderCommentContent={renderCommentContent}
      // replyCount={replies?.length}
    />
  )
}
