import {createPortal} from 'react-dom'
import {BlockRange, HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId, commentIdToHmId} from '@shm/shared'
import {
  cloneElement,
  createContext,
  isValidElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  CommentsProvider,
  useCommentsServiceContext,
  useCommentDraftReferences,
} from '@shm/shared/comments-service-provider'
import {getCommentThread} from '@shm/shared/comments'
import {useDocumentComments} from '@shm/shared/models/comments'
import {useDocumentCollaborators} from '@shm/shared/models/entity'
import {useTxString} from '@shm/shared/translation'
import {FileText, MessageCirclePlus, LetterText} from 'lucide-react'
import type {CommentEditorProps} from './resource-page-common'
import {BlockDiscussions, CommentDiscussions, Discussions} from './comments'
import {PageLayout} from './page-layout'
import {ScrollArea} from './components/scroll-area'
import {getRenderedCollaboratorsCount} from './collaborators-page'

/** Footer destination outside the main document scroll area. */
export const CommentsFooterContext = createContext<HTMLDivElement | null | undefined>(undefined)

/** Content and layout options for the document comments view. */
export interface DiscussionsPageContentProps {
  /** Keep the editor below a separately scrolling panel list. */
  isPanel?: boolean
  docId: UnpackedHypermediaId
  openComment?: string
  replyCommentId?: string
  targetBlockId?: string
  blockId?: string
  blockRange?: BlockRange | null
  commentEditor?: ReactNode
  targetDomain?: string
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
  isPanel = false,
  openComment,
  replyCommentId,
  targetBlockId,
  blockId,
  blockRange,
  commentEditor,
  targetDomain,
  showTitle = true,
  contentMaxWidth,
}: DiscussionsPageContentProps) {
  const footerTarget = useContext(CommentsFooterContext)
  const [submittedRoots, setSubmittedRoots] = useState<HMComment[]>([])
  const comments = useDocumentComments(docId)
  const thread = openComment ? getCommentThread(comments.data?.comments, openComment) : null
  const root = thread?.root && !thread.root.replyParent ? thread.root : undefined
  const commentsContext = useCommentsServiceContext()
  const draftReferences = useCommentDraftReferences()
  const appendReference = draftReferences?.appendReference
  const onThreadReplyClick = useCallback(
    (comment: HMComment) => {
      if (!root || !appendReference) return
      appendReference({
        documentId: docId.id,
        commentId: root.id,
        link: packHmId({...commentIdToHmId(comment.id), version: comment.version, latest: null}),
      })
    },
    [docId.id, root?.id, appendReference],
  )
  const appliedReply = useRef<string>()
  const selectedReply = thread?.replies.find((comment) => comment.id === replyCommentId)
  useEffect(() => {
    const selection = replyCommentId ? `${docId.id}:${root?.id}:${replyCommentId}` : undefined
    if (!selection) {
      appliedReply.current = undefined
      return
    }
    if (!selectedReply || !root || !appendReference || appliedReply.current === selection) return
    appliedReply.current = selection
    appendReference({
      documentId: docId.id,
      commentId: root.id,
      link: packHmId({...commentIdToHmId(selectedReply.id), version: selectedReply.version, latest: null}),
    })
  }, [docId.id, root?.id, replyCommentId, selectedReply, appendReference])
  useEffect(() => {
    setSubmittedRoots([])
  }, [docId.id, openComment, targetBlockId])
  let editor = commentEditor
  if (isValidElement<CommentEditorProps>(commentEditor)) {
    editor =
      openComment && !root
        ? null
        : cloneElement(commentEditor, {
            key: [
              root?.id || 'root',
              targetBlockId || '',
              JSON.stringify(blockRange),
              commentEditor.props.focusOnMount ? 'focus' : 'browse',
            ].join(':'),
            compact: true,
            commentId: root?.id,
            replyCommentVersion: root?.version,
            rootReplyCommentVersion: root?.version,
            onCommentSubmitted: (comment: HMComment) => {
              // Submission selects the new reply; it is not a request to quote it again.
              if (root) appliedReply.current = `${docId.id}:${root.id}:${comment.id}`
              if (!openComment)
                setSubmittedRoots((roots) => [...roots.filter((root) => root.id !== comment.id), comment])
              commentEditor.props.onCommentSubmitted?.(comment)
            },
          })
  }
  // Determine which view to show
  let content: ReactNode

  if (targetBlockId && !openComment) {
    const targetId = hmId(docId.uid, {
      ...docId,
      blockRef: targetBlockId,
    })
    content = <BlockDiscussions targetId={targetId} targetDomain={targetDomain} blockRange={blockRange || undefined} />
  } else if (openComment) {
    content = (
      <CommentDiscussions
        commentId={openComment}
        replyCommentId={replyCommentId}
        targetId={docId}
        targetDomain={targetDomain}
        isEntirelyHighlighted
        selection={blockId ? {blockId, blockRange: blockRange || undefined} : undefined}
      />
    )
  } else {
    content = (
      <>
        <Discussions
          scrollKey={`${docId.id}:${isPanel ? 'panel' : 'expanded'}`}
          targetId={docId}
          targetDomain={targetDomain}
          submittedRoots={submittedRoots}
          emptyState={isPanel ? <CommentsPanelEmptyState docId={docId} hasEditor={!!editor} /> : undefined}
          onCommentDeleted={(id) => setSubmittedRoots((roots) => roots.filter((root) => root.id !== id))}
        />
      </>
    )
  }

  const hasEnteredThread = useRef(!!openComment)
  if (openComment) hasEnteredThread.current = true
  const direction = openComment ? 'thread' : hasEnteredThread.current ? 'roots' : undefined
  content = (
    <div
      key={openComment || targetBlockId || 'roots'}
      className="comments-view flex min-h-0 flex-1 flex-col"
      data-comments-view={direction}
    >
      {content}
    </div>
  )

  let layout: ReactNode
  if (isPanel) {
    layout = (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <ScrollArea className="bg-muted dark:bg-background min-h-0 flex-1" fillViewportContent>
          <div className="flex flex-1 flex-col p-4">{content}</div>
        </ScrollArea>
        {editor && <div className="bg-background border-border shrink-0 border-t px-3 pt-3 pb-2">{editor}</div>}
      </div>
    )
  } else {
    layout = (
      <div className="py-4">
        <PageLayout
          title={showTitle ? 'Comments' : undefined}
          contentMaxWidth={contentMaxWidth}
          contentClassName="px-4"
        >
          {content}
          {editor && footerTarget === undefined && <div className="bg-background mt-4 rounded-lg p-3">{editor}</div>}
        </PageLayout>
        {editor &&
          footerTarget &&
          createPortal(
            <div className="bg-background border-border border-t pt-3 pb-2">
              <PageLayout contentMaxWidth={contentMaxWidth} contentClassName="px-4">
                {editor}
              </PageLayout>
            </div>,
            footerTarget,
          )}
      </div>
    )
  }

  return (
    <CommentsProvider
      {...commentsContext}
      onReplyClick={openComment ? onThreadReplyClick : commentsContext.onReplyClick}
    >
      {layout}
    </CommentsProvider>
  )
}

function CommentsPanelEmptyState({docId, hasEditor}: {docId: UnpackedHypermediaId; hasEditor: boolean}) {
  const tx = useTxString()
  const collaborators = useDocumentCollaborators(docId)
  const count = getRenderedCollaboratorsCount(collaborators.data, !docId.path?.length)
  const hasAudience = collaborators.data && !collaborators.isError && count > 0

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 font-sans">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="bg-brand-11 text-brand-2 flex size-12 items-center justify-center rounded-full">
            <MessageCirclePlus className="size-6" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h3 className="text-base font-semibold">{tx('Start the conversation')}</h3>
          <p className="text-sm leading-5">
            {hasAudience
              ? tx(
                  'comments.empty.audience',
                  ({count}: {count: number}) =>
                    `No comments yet. Share a question or idea with the ${count} ${
                      count === 1 ? 'person' : 'people'
                    } in this space.`,
                  {count},
                )
              : tx('No comments yet. Share a question or idea in this space.')}
          </p>
        </div>
        {hasEditor && (
          <div className="flex w-full flex-col gap-2">
            <div className="border-border bg-card flex items-start gap-3 rounded-xl border p-4">
              <FileText className="text-brand-2 size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-1 text-sm leading-5">
                <p className="font-semibold">{tx('On the whole doc')}</p>
                <p className="text-muted-foreground">{tx('Write in the box below.')}</p>
              </div>
            </div>
            <div className="border-border bg-card flex items-start gap-3 rounded-xl border p-4">
              <LetterText className="text-brand-2 size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <div className="flex min-w-0 flex-col gap-1 text-sm leading-5">
                <p className="font-semibold">{tx('On a specific part')}</p>
                <p className="text-muted-foreground">{tx('Select any text in the doc.')}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
