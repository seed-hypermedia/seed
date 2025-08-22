import {
  HMAccountsMetadata,
  HMComment,
  HMCommentCitation,
  HMDocument,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {
  Comment,
  CommentDiscussions,
  CommentGroup,
  Discussions,
  EmptyDiscussions,
  QuotedDocBlock,
} from '@shm/ui/comments'
import {BlocksContent} from '@shm/ui/document-content'
import {Spinner} from '@shm/ui/spinner'
import React, {useCallback, useMemo} from 'react'

import {getCommentTargetId} from '@shm/shared'
import {useTxString} from '@shm/shared/translation'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {cn} from '@shm/ui/utils'
import {WebDocContentProvider} from './doc-content-provider'
import {useBlockDiscussions, useDiscussion} from './models'

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
  commentEditor?: React.ReactNode
}

export const WebDiscussionsPanel = React.memo(_WebDiscussionsPanel)

function _WebDiscussionsPanel(props: DiscussionsPanelProps) {
  const {homeId, comment, blockId, siteHost, handleBack, commentEditor} = props
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
        handleBack={handleBack}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  if (comment) {
    return (
      <CommentDiscussions
        onBack={handleBack}
        commentId={comment.id}
        commentEditor={commentEditor}
        targetId={props.docId}
        renderCommentContent={renderCommentContent}
      />
    )
  }

  return (
    <>
      <Discussions
        commentEditor={commentEditor}
        targetId={props.docId}
        renderCommentContent={renderCommentContent}
      />
    </>
  )
}

function BlockDiscussions({
  docId,
  blockId,
  document,
  siteHost,
  originHomeId,
  renderCommentContent,
  enableWebSigning,
  handleBack,
}: DiscussionsPanelProps & {
  renderCommentContent: (comment: HMComment) => React.ReactNode
}) {
  const tx = useTxString()
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
        <EmptyDiscussions emptyReplies />
      )
  }
  return (
    <div className="flex flex-col gap-4 px-2">
      <div className="rounded-md p-3">
        <AccessoryBackButton
          onClick={handleBack}
          label={tx('All Discussions')}
        />
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
    renderCommentContent: (comment: HMComment) => React.ReactNode
  },
) {
  const {comment, renderCommentContent, handleBack} = props
  const tx = useTxString()
  const discussion = useDiscussion(getCommentTargetId(comment), comment?.id)

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
      <div className="mx-3 mb-0 flex flex-col">
        <AccessoryBackButton
          onClick={handleBack}
          label={tx('All Discussions')}
        />
      </div>

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
      // @ts-expect-error
      comment.content[0].block.type === 'Embed' &&
      citationTarget
    ) {
      const firstBlockNode = comment.content[0]
      // @ts-expect-error
      const singleEmbedId = unpackHmId(firstBlockNode.block.link)
      if (
        // @ts-expect-error
        firstBlockNode.children?.length &&
        // @ts-expect-error
        singleEmbedId?.type === citationTarget.type &&
        // @ts-expect-error
        singleEmbedId.id === citationTarget.id &&
        // @ts-expect-error
        singleEmbedId.blockRef === citationTargetFragment?.blockId
      ) {
        return {
          ...comment,
          // @ts-expect-error
          content: firstBlockNode.children,
        } satisfies HMComment
      }
    }
    return comment
  }, [comment, citationTargetFragment, citationTarget])
  const docId = comment
    ? hmId(comment.targetAccount, {
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
      // @ts-expect-error
      rootCommentId={comment.threadRoot ?? null}
      rootCommentVersion={comment.threadRootVersion ?? null}
      authorMetadata={accounts[comment.author]?.metadata}
      renderCommentContent={renderCommentContent}
      // replyCount={replies?.length}
    />
  )
}
