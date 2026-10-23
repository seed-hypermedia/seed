import type {HMBlockNode, HMComment, HMContactItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {type AnyTimestamp, normalizeDate, useRouteLink} from '@shm/shared'
import {extractRefs} from '@shm/shared/content'
import {contentToText} from '@shm/shared/content-to-text'
import type {LoadedCommentEvent, LoadedEvent} from '@shm/shared/models/activity-service'
import {useResource} from '@shm/shared/models/entity'
import {useMentionNames} from '@shm/shared/models/inline-mentions'
import type {NavRoute} from '@shm/shared/routes'
import {getCommentTargetId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {type ReactNode, useMemo, useRef, useState} from 'react'
import {AccountAvatar} from './account-avatar'
import {getBlockNodeById} from './blocks-content-utils'
import {CommentContent} from './comments'
import {Dialog, DialogContent, DialogTitle} from './components/dialog'
import {AuthorNameLink, DocumentNameLink, Timestamp} from './inline-descriptor'
import {cn} from './utils'

/** Event types the All updates tab asks the server for. Citations and writer grants are left out. */
export const ALL_UPDATES_EVENT_TYPES = ['Ref', 'Comment', 'Contact']

/**
 * Splits off the quote a block comment starts with. The comment's text is stored as an Embed's children,
 * so the body is the children followed by any later blocks. Returns the quoted block's id.
 */
export function getCommentQuote(
  comment: Pick<HMComment, 'content' | 'targetAccount' | 'targetPath' | 'targetVersion'>,
): {
  quoteId: UnpackedHypermediaId | null
  body: HMBlockNode[]
} {
  const [firstNode, ...rest] = comment.content
  const first = firstNode?.block
  const quoteId = first?.type === 'Embed' ? unpackHmId(first.link) : null
  const targetId = getCommentTargetId(comment as HMComment)
  const isQuote =
    !!quoteId?.blockRef &&
    !!targetId &&
    quoteId.uid === targetId.uid &&
    (quoteId.path ?? []).join('/') === (targetId.path ?? []).join('/')
  return isQuote ? {quoteId, body: [...(firstNode?.children ?? []), ...rest]} : {quoteId: null, body: comment.content}
}

/** Drops a comment's images, videos and files, so quoting it as text never shows their links. */
export function withoutMedia(content: HMBlockNode[]): HMBlockNode[] {
  return content.flatMap((node) => {
    const {type} = node.block
    if (type === 'Image' || type === 'Video' || type === 'File') return []
    return [{...node, children: node.children ? withoutMedia(node.children) : node.children}]
  })
}

/** Gives every image and video in a comment the thumbnail width, keeping each where it sits in the comment. */
export function withMediaThumbnails(content: HMBlockNode[]): HMBlockNode[] {
  return content.map((node) => {
    const {block} = node
    const children = node.children ? withMediaThumbnails(node.children) : node.children
    if (block.type === 'Image' || block.type === 'Video') {
      // Smaller width for the preview.
      return {...node, block: {...block, attributes: {...block.attributes, width: 160}}, children}
    }
    return {...node, children}
  })
}

/**
 * When an event happened, or null when nothing reliable is known. A home document's genesis change carries a zero
 * timestamp, so its created event falls back to the document's own creation time, and shows no date if it's unknown.
 */
export function getEventTime(event: LoadedEvent) {
  const isKnown = (time: AnyTimestamp) => (normalizeDate(time)?.getTime() ?? 0) > 0
  if (isKnown(event.time)) return event.time
  if (event.type === 'doc-update' && isKnown(event.document.createTime)) return event.document.createTime
  return null
}

/** How a comment card describes the comment's action. */
export function getCommentAction(
  event: Pick<LoadedCommentEvent, 'author' | 'replyingComment' | 'replyParentAuthor'>,
): {kind: 'commented'} | {kind: 'replied-to'; parentAuthor: HMContactItem} | {kind: 'replied'} {
  if (!event.replyingComment) return {kind: 'commented'}
  const parentAuthor = event.replyParentAuthor
  if (!parentAuthor?.id?.uid || parentAuthor.id.uid === event.author?.id?.uid) return {kind: 'replied'}
  return {kind: 'replied-to', parentAuthor}
}

/** One event in the All updates tab, as a card. */
export function ActivityEventCard({event, route}: {event: LoadedEvent; route: NavRoute | null}) {
  if (event.type === 'doc-update') {
    const isCreated = event.document.version === event.document.genesis
    return (
      <CardShell event={event} route={route}>
        <span>{isCreated ? 'created the document' : 'updated document'}</span>{' '}
        <DocumentNameLink metadata={event.document.metadata} id={event.docId} fallback={'Untitled Document'} />
      </CardShell>
    )
  }

  if (event.type === 'contact') {
    // Only joining the space.
    if (!event.contact.subscribe?.site) return null
    return (
      <CardShell event={event} route={route}>
        <span>joined the space</span>
      </CardShell>
    )
  }

  if (event.type === 'comment' && event.comment) {
    const action = getCommentAction(event)
    return (
      <CardShell
        event={event}
        route={route}
        body={<CommentCardBody comment={event.comment} replyingComment={event.replyingComment} />}
      >
        {action.kind === 'commented' ? (
          <span>commented on</span>
        ) : action.kind === 'replied-to' ? (
          <>
            <span>replied to</span> <AuthorNameLink author={action.parentAuthor} /> <span>in</span>
          </>
        ) : (
          <span>replied in</span>
        )}{' '}
        {event.target?.id ? (
          <DocumentNameLink metadata={event.target.metadata} id={event.target.id} fallback={'Untitled Document'} />
        ) : null}
      </CardShell>
    )
  }

  return null
}

function CardShell({
  event,
  route,
  children,
  body,
}: {
  event: LoadedEvent
  route: NavRoute | null
  children: ReactNode
  body?: ReactNode
}) {
  const linkProps = useRouteLink(route)
  const time = getEventTime(event)
  return (
    <div
      className="bg-background hover:bg-muted/40 flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors"
      onClick={linkProps.onClick}
    >
      <div className="flex items-start gap-2">
        {event.author?.id ? (
          <AccountAvatar
            className="mt-0.5 shrink-0"
            size={24}
            id={event.author.id}
            name={event.author.metadata?.name}
            icon={event.author.metadata?.icon}
          />
        ) : null}
        <p className="min-w-0 flex-1 text-sm font-semibold">
          <AuthorNameLink author={event.author} /> {children}
        </p>
        <span className="text-muted-foreground shrink-0 pt-0.5 text-xs">{time ? <Timestamp time={time} /> : null}</span>
      </div>
      {body}
    </div>
  )
}

function CommentCardBody({comment, replyingComment}: {comment: HMComment; replyingComment: HMComment | null}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isClipped, setIsClipped] = useState(false)
  const [openMedia, setOpenMedia] = useState<OpenMedia | null>(null)
  const clipRef = useRef<HTMLDivElement>(null)
  const {quoteId, body} = useMemo(() => getCommentQuote(comment), [comment])
  const content = useMemo(() => withMediaThumbnails(body), [body])

  // The comment renders asynchronously and images load late, so re-measure whenever its size changes.
  useIsomorphicLayoutEffect(() => {
    const clip = clipRef.current
    if (!clip || isExpanded) return
    const measure = () => setIsClipped(clip.scrollHeight > clip.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(clip)
    if (clip.firstElementChild) observer.observe(clip.firstElementChild)
    return () => observer.disconnect()
  }, [isExpanded, content])

  return (
    <div className="flex flex-col gap-2">
      {replyingComment ? <CommentQuote comment={replyingComment} /> : quoteId ? <BlockQuote id={quoteId} /> : null}
      <div
        ref={clipRef}
        // About three lines on desktop and web, two on phones, until "See all" is shown.
        className={cn('relative min-w-0 break-words', !isExpanded && 'max-h-14 overflow-hidden sm:max-h-20')}
        onClickCapture={(event) => {
          // Images and videos open a larger preview instead of opening the comment.
          const media = (event.target as HTMLElement).closest('img, video')
          const src = media && (media as HTMLImageElement | HTMLVideoElement).currentSrc
          if (!media || !src) return
          event.preventDefault()
          event.stopPropagation()
          setOpenMedia({type: media.tagName === 'VIDEO' ? 'video' : 'image', src})
        }}
      >
        <CommentContent comment={{...comment, content}} size="sm" />
        {!isExpanded && isClipped ? (
          <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t to-transparent" />
        ) : null}
      </div>
      {!isExpanded && isClipped ? (
        <button
          type="button"
          className="text-brand-4 self-start text-sm font-semibold hover:underline"
          onClick={(event) => {
            event.stopPropagation()
            setIsExpanded(true)
          }}
        >
          See all
        </button>
      ) : null}
      <MediaDialog media={openMedia} onClose={() => setOpenMedia(null)} />
    </div>
  )
}

// The green quote box that shows what the comment is left on.
function QuoteBox({children}: {children: ReactNode}) {
  return (
    <div className="border-brand bg-brand-12 rounded-r border-l-2 px-3 py-1.5">
      <p className="text-brand-4 line-clamp-1 text-sm sm:line-clamp-2">{children}</p>
    </div>
  )
}

// A reply quotes the comment it answers, without that comment's own quote or media.
function CommentQuote({comment}: {comment: HMComment}) {
  const text = useMemo(() => withoutMedia(getCommentQuote(comment).body), [comment])
  const mentionNames = useMentionNames(useMemo(() => extractRefs(text), [text]))
  const quote = contentToText({content: text, resolvedNames: mentionNames, lineBreaks: false})
  return quote ? <QuoteBox>{quote}</QuoteBox> : null
}

// A block comment quotes the block it's on, read from the document version the comment points at.
function BlockQuote({id}: {id: UnpackedHypermediaId}) {
  const resource = useResource(id)
  const block =
    resource.data?.type === 'document' && id.blockRef
      ? getBlockNodeById(resource.data.document.content || [], id.blockRef)
      : null
  const content = useMemo(() => (block ? [{...block, children: []}] : []), [block])
  const mentionNames = useMentionNames(useMemo(() => extractRefs(content), [content]))
  const quote = contentToText({content, resolvedNames: mentionNames, lineBreaks: false})
  return quote ? <QuoteBox>{quote}</QuoteBox> : null
}

type OpenMedia = {type: 'image' | 'video'; src: string}

// Clicks inside the dialog would otherwise bubble through the portal to the card and open the comment.
function MediaDialog({media, onClose}: {media: OpenMedia | null; onClose: () => void}) {
  return (
    <Dialog open={!!media} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl" onClick={(event) => event.stopPropagation()}>
        <DialogTitle className="sr-only">{media?.type === 'video' ? 'Video' : 'Image'}</DialogTitle>
        {media?.type === 'image' ? (
          <img src={media.src} alt="" className="max-h-[80vh] w-full object-contain" />
        ) : media ? (
          <video src={media.src} controls autoPlay className="max-h-[80vh] w-full" />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
