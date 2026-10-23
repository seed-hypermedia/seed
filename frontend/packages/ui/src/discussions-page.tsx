import {BlockRange, HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useCommentParents} from '@shm/shared'
import {cloneElement, isValidElement, ReactNode, useEffect, useState} from 'react'
import {getCommentContinuation} from '@shm/shared/comments'
import {useDocumentComments} from '@shm/shared/models/comments'
import type {CommentEditorProps} from './resource-page-common'
import {BlockDiscussions, CommentDiscussions, Discussions} from './comments'
import {PageLayout} from './page-layout'

export interface DiscussionsPageContentProps {
  docId: UnpackedHypermediaId
  openComment?: string
  replyCommentId?: string
  targetBlockId?: string
  blockId?: string
  blockRange?: BlockRange | null
  autoFocus?: boolean
  isReplying?: boolean
  commentEditor?: ReactNode
  targetDomain?: string
  /** Called when user wants to go back to all discussions */
  onBackToAll?: () => void
  /** Whether to show the "Open in Panel" button. Defaults to true. */
  showOpenInPanel?: boolean
  /** Whether to show the title. Defaults to true. */
  showTitle?: boolean
  /** Custom max width for centered content */
  contentMaxWidth?: number
}

/**
 * Full-page discussions content component.
 * Can be used standalone (page) or the underlying components reused in panel.
 */
export function DiscussionsPageContent({
  docId,
  openComment,
  replyCommentId,
  targetBlockId,
  blockId,
  blockRange,
  commentEditor,
  targetDomain,
  showOpenInPanel: _showOpenInPanel = true,
  showTitle = true,
  contentMaxWidth,
}: DiscussionsPageContentProps) {
  const [submittedRoots, setSubmittedRoots] = useState<HMComment[]>([])
  const comments = useDocumentComments(docId)
  const continuation = openComment ? getCommentContinuation(comments.data?.comments, openComment, replyCommentId) : null
  const target = continuation?.chain.at(-1)
  const parents = useCommentParents(comments.data?.comments, target?.id ?? '')
  useEffect(() => {
    setSubmittedRoots([])
  }, [docId.id, openComment, targetBlockId])
  let editor = commentEditor
  if (isValidElement<CommentEditorProps>(commentEditor)) {
    editor =
      replyCommentId && !continuation
        ? null
        : cloneElement(commentEditor, {
            key: [target?.id || openComment || 'root', targetBlockId || '', JSON.stringify(blockRange)].join(':'),
            commentId: target?.id || openComment,
            replyCommentVersion: target?.version ?? commentEditor.props.replyCommentVersion,
            rootReplyCommentVersion:
              target?.threadRootVersion || commentEditor.props.rootReplyCommentVersion || parents?.thread[0]?.version,
            onCommentSubmitted: (comment: HMComment) => {
              if (!openComment)
                setSubmittedRoots((roots) => [...roots.filter((root) => root.id !== comment.id), comment])
              commentEditor.props.onCommentSubmitted?.(comment)
            },
          })
  }
  // Determine which view to show
  let content: ReactNode

  if (targetBlockId) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: targetBlockId,
    })
    content = (
      <BlockDiscussions
        targetId={targetId}
        commentEditor={editor}
        targetDomain={targetDomain}
        blockRange={blockRange || undefined}
      />
    )
  } else if (openComment) {
    content = (
      <CommentDiscussions
        commentId={openComment}
        replyCommentId={replyCommentId}
        commentEditor={editor}
        targetId={docId}
        targetDomain={targetDomain}
        isEntirelyHighlighted={!blockId}
        selection={blockId ? {blockId, blockRange: blockRange || undefined} : undefined}
      />
    )
  } else {
    content = (
      <>
        {editor}
        <Discussions
          targetId={docId}
          targetDomain={targetDomain}
          submittedRoots={submittedRoots}
          onCommentDeleted={(id) => setSubmittedRoots((roots) => roots.filter((root) => root.id !== id))}
        />
      </>
    )
  }

  return (
    <div className="p-4">
      <PageLayout title={showTitle ? 'Discussions' : undefined} contentMaxWidth={contentMaxWidth}>
        {content}
      </PageLayout>
    </div>
  )
}
