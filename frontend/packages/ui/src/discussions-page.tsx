import {BlockRange, hmId, UnpackedHypermediaId} from '@shm/shared'
import {ReactNode} from 'react'
import {BlockDiscussions, CommentDiscussions, Discussions} from './comments'
import {PageLayout} from './page-layout'

export interface DiscussionsPageContentProps {
  docId: UnpackedHypermediaId
  openComment?: string
  targetBlockId?: string
  blockId?: string
  blockRange?: BlockRange | null
  autoFocus?: boolean
  isReplying?: boolean
  commentEditor?: ReactNode
  targetDomain?: string
  currentAccountId?: string
  onCommentDelete?: (commentId: string, signingAccountId?: string) => void
  deleteCommentDialogContent?: ReactNode
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
  targetBlockId,
  blockId,
  blockRange,
  commentEditor,
  targetDomain,
  currentAccountId,
  onCommentDelete,
  deleteCommentDialogContent,
  showOpenInPanel: _showOpenInPanel = true,
  showTitle = true,
  contentMaxWidth,
}: DiscussionsPageContentProps) {
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
        commentEditor={commentEditor}
        targetDomain={targetDomain}
        currentAccountId={currentAccountId}
        onCommentDelete={onCommentDelete}
      />
    )
  } else if (openComment) {
    content = (
      <CommentDiscussions
        commentId={openComment}
        commentEditor={commentEditor}
        targetId={docId}
        targetDomain={targetDomain}
        currentAccountId={currentAccountId}
        onCommentDelete={onCommentDelete}
        isEntirelyHighlighted={!blockId}
        selection={
          blockId ? {blockId, blockRange: blockRange || undefined} : undefined
        }
      />
    )
  } else {
    content = (
      <>
        {commentEditor}
        <Discussions
          targetId={docId}
          targetDomain={targetDomain}
          currentAccountId={currentAccountId}
          onCommentDelete={onCommentDelete}
        />
      </>
    )
  }

  return (
    <div className="p-4">
      <PageLayout
        title={showTitle ? 'Discussions' : undefined}
        contentMaxWidth={contentMaxWidth}
      >
        {deleteCommentDialogContent}
        {content}
      </PageLayout>
    </div>
  )
}
