import {BlockRange, hmId, UnpackedHypermediaId} from '@shm/shared'
import {MessageSquare} from 'lucide-react'
import {ReactNode} from 'react'
import {BlockDiscussions, CommentDiscussions, Discussions} from './comments'
import {OpenInPanelButton} from './open-in-panel'
import {PageLayout} from './page-layout'
import {SizableText} from './text'

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
  showOpenInPanel = true,
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
        centered
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
        selection={
          blockId ? {blockId, blockRange: blockRange || undefined} : undefined
        }
        centered
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
          centered
        />
      </>
    )
  }

  return (
    <PageLayout
      title={showTitle ? 'Discussions' : undefined}
      centered
      contentMaxWidth={contentMaxWidth}
      headerRight={
        showOpenInPanel ? (
          <OpenInPanelButton
            id={docId}
            panelRoute={{key: 'discussions', id: docId}}
          />
        ) : undefined
      }
    >
      {deleteCommentDialogContent}
      {content}
    </PageLayout>
  )
}

export function DiscussionsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <MessageSquare className="text-muted-foreground size-16" />
      <SizableText color="muted" weight="medium" size="xl">
        No discussions yet
      </SizableText>
      <SizableText color="muted" size="sm">
        Start a conversation by leaving a comment
      </SizableText>
    </div>
  )
}
