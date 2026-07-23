import type {HMResource} from '@seed-hypermedia/client/hm-types'
import {
  BlockRange,
  HMBlock,
  HMBlockChildrenType,
  HMBlockEmbed,
  HMBlockNode,
  HMComment,
  HMDocument,
  HMEmbedView,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  abbreviateUid,
  formattedDateMedium,
  getRoutePanel,
  getCommentTargetId,
  getDocumentTitle,
  RenderResourceProvider,
  shouldBlockEmbeddedResource,
  unpackHmId,
  useRenderResourceStack,
  useRouteLink,
  useUniversalClient,
} from '@shm/shared'
import {useAccount, useResource, useResources} from '@shm/shared/models/entity'
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {isHmDescendantOf} from '@shm/shared/utils/breadcrumbs'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {DocumentPanelRoute} from '@shm/shared/routes'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {AlertCircle, FileSymlink as FileSymlinkIcon, FileText as FileTextIcon, Globe, Undo2} from 'lucide-react'
import React, {ReactNode, useCallback, useMemo, useState} from 'react'
import {toast} from 'sonner'
import {getBlockNodeById} from './blocks-content-utils'
import {Button} from './button'
import {CommentContent, Discussions} from './comments'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {EmbedWrapper, getEmbedDocumentRoute} from './embed-wrapper'
import {HMIcon} from './hm-icon'
import {DocumentNameLink} from './inline-descriptor'
import {DocumentCard} from './newspaper'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Props shared by embed block renderers. */
type BlockContentProps<BlockType extends HMBlock = HMBlock> = {
  block: BlockType
  parentBlockId: string | null
  depth?: number
  style?: React.CSSProperties
}

/** Displays an error message with optional debug data toggle. */
export function ErrorBlock({
  message,
  debugData,
  children,
}: {
  message: string
  debugData?: any
  children?: React.ReactNode
}) {
  let [open, toggleOpen] = useState(false)
  return (
    <Tooltip content={debugData ? (open ? 'Hide debug Data' : 'Show debug data') : ''}>
      <div className="block-content block-unknown flex flex-1 flex-col">
        <div
          className="flex-start flex items-center gap-2 overflow-hidden rounded-md border border-red-300 bg-red-100 p-2"
          onClick={(e) => {
            e.stopPropagation()
            toggleOpen((v) => !v)
          }}
        >
          <SizableText color="destructive" className="font-sans text-sm">
            {message ? message : 'Error'}
          </SizableText>
          <AlertCircle color="danger" className="size-3" />
          {children}
        </div>
        {open ? (
          <pre className="border-border rounded-md border bg-gray-100 p-2 dark:bg-gray-800">
            <code className="font-mono text-xs wrap-break-word">{JSON.stringify(debugData, null, 4)}</code>
          </pre>
        ) : null}
      </div>
    </Tooltip>
  )
}

/** Warning banner for embeds whose content has been deleted. Shows a toggle when content is available. */
export function DeletedEmbedBanner({children, entityLabel = 'document'}: {children?: ReactNode; entityLabel?: string}) {
  const [showContent, setShowContent] = useState(false)
  const hasContent = !!children
  return (
    <div className="block-content flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100 p-2 dark:border-amber-600 dark:bg-amber-900/30">
        <AlertCircle className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
        <SizableText className="flex-1 text-sm text-amber-800 dark:text-amber-200">
          This embedded {entityLabel} has been deleted
        </SizableText>
        {hasContent ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setShowContent((v) => !v)
            }}
          >
            {showContent ? 'Hide content' : 'Show content'}
          </Button>
        ) : null}
      </div>
      {showContent && hasContent ? children : null}
    </div>
  )
}

/** Renders an embedded document as a card view. */
export function BlockEmbedCard({
  block,
  parentBlockId,
  openOnClick = true,
  titleLinkOnly = false,
  hideInlineActions = false,
}: BlockContentProps<HMBlockEmbed> & {
  openOnClick?: boolean
  titleLinkOnly?: boolean
  hideInlineActions?: boolean
}) {
  const id = unpackHmId(block.link) ?? undefined
  const currentRoute = useNavRoute()
  const documentRoute = useMemo(() => (id ? getEmbedDocumentRoute(id, currentRoute) : undefined), [id, currentRoute])
  const renderResourceStack = useRenderResourceStack()
  const parentDocumentId = [...renderResourceStack].reverse().find((resource) => resource.kind === 'document')?.id
  const doc = useResource(id, {subscribed: true})
  // Check tombstone on latest version for version-pinned embeds.
  // Version-specific fetches skip the backend's tombstone check.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : undefined
  const latestCheck = useResource(latestCheckId)
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const authors = useResources(document?.authors.map((uid: string) => hmId(uid)) || [])
  const isDeleted =
    doc.isTombstone ||
    doc.data?.type === 'tombstone' ||
    latestCheck.data?.type === 'tombstone' ||
    latestCheck.isTombstone
  if (doc.isInitialLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  // No content available at all — banner without toggle
  if (doc.data?.type === 'tombstone') {
    return <DeletedEmbedBanner />
  }
  if (doc.data?.type === 'not-found') {
    if (doc.isDiscovering) {
      return (
        <div className="flex items-center justify-center gap-2 p-4">
          <Spinner className="size-4" />
          <SizableText className="text-muted-foreground">Looking for this content…</SizableText>
        </div>
      )
    }
    return <ErrorBlock message="Could not load embed" />
  }
  if (doc.data?.type === 'error') {
    return <ErrorBlock message={doc.data.message} />
  }
  if (doc.isError || !doc.data) return <ErrorBlock message="Could not load embed" />

  const accountsMetadata = Object.fromEntries(
    authors
      .map((d: any) => d.data)
      .filter((d: any) => !!d)
      .map((authorDoc: any) => [
        authorDoc.id.uid,
        {
          id: authorDoc.id,
          metadata: authorDoc.type === 'document' ? authorDoc.document?.metadata : undefined,
        },
      ])
      .filter(([_, metadata]) => !!metadata),
  )

  if (!id) return <ErrorBlock message="Invalid Embed URL" />

  const card = (
    <EmbedWrapper
      id={id}
      parentBlockId={parentBlockId}
      hideBorder
      route={documentRoute}
      openOnClick={false}
      viewType="Card"
    >
      <DocumentCard
        entity={{
          id,
          document: document,
        }}
        docId={id}
        route={documentRoute}
        accountsMetadata={accountsMetadata}
        navigate={openOnClick && !titleLinkOnly}
        titleLinkOnly={titleLinkOnly}
        hideInlineActions={hideInlineActions}
        relocationOrigin={parentDocumentId ? {parentDocumentId, embedBlockId: block.id} : undefined}
        showSummary
      />
    </EmbedWrapper>
  )

  if (isDeleted) {
    return <DeletedEmbedBanner>{card}</DeletedEmbedBanner>
  }

  return card
}

/**
 * Renders an embed as a single-row "link". Can be external or HM link
 */
export function BlockEmbedLink({
  block,
  parentBlockId,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {
  openOnClick?: boolean
}) {
  const url = block.link
  const id = useMemo(() => unpackHmId(url) ?? undefined, [url])
  const isHm = !!id

  if (isHm && id) {
    return <HmLinkEmbed id={id} parentBlockId={parentBlockId} openOnClick={openOnClick} />
  }
  return <ExternalLinkEmbed url={url} parentBlockId={parentBlockId} openOnClick={openOnClick} />
}

/** HM-link variant: loads the target doc, picks the subdoc vs cross-doc icon,
 *  and renders a compact horizontal "card" with the same visual treatment as
 *  Card view. */
function HmLinkEmbed({
  id,
  parentBlockId,
  openOnClick,
}: {
  id: UnpackedHypermediaId
  parentBlockId: string | null
  openOnClick: boolean
}) {
  const currentRoute = useNavRoute()
  const doc = useResource(id, {subscribed: true})
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const title = getDocumentTitle(document) || abbreviateUid(id.uid)
  const renderStack = useRenderResourceStack()
  const parentDocId =
    [...renderStack].reverse().find((entry) => entry.kind === 'document' && entry.id.id !== id.id)?.id ?? null
  const isSubdoc = isHmDescendantOf(id, parentDocId)
  const Icon = isSubdoc ? FileTextIcon : FileSymlinkIcon
  const documentRoute = useMemo(() => getEmbedDocumentRoute(id, currentRoute), [id, currentRoute])
  const titleLink = useRouteLink(openOnClick ? null : documentRoute)
  const titleIsLink = !openOnClick && !!titleLink.href

  return (
    <EmbedWrapper
      id={id}
      parentBlockId={parentBlockId}
      hideBorder
      route={documentRoute}
      openOnClick={openOnClick}
      viewType="Link"
    >
      <div
        className={cn(
          'hover:bg-accent dark:hover:bg-accent flex w-full items-center gap-3 overflow-hidden rounded-lg',
          'bg-white shadow-md transition-colors duration-300 dark:bg-black',
          'px-3 py-2',
        )}
      >
        {/* Green icon placeholder, mirrors DocumentCard's no-cover variant. */}
        <div className="flex aspect-square size-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/30">
          <Icon className="size-5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {titleIsLink ? (
            <a
              href={titleLink.href}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                titleLink.onClick?.(e)
              }}
              className="line-clamp-2 max-w-full text-base font-bold text-blue-600 no-underline hover:underline dark:text-blue-400"
            >
              {title}
            </a>
          ) : (
            <span className="line-clamp-2 max-w-full text-base font-bold text-blue-600 dark:text-blue-400">
              {title}
            </span>
          )}
        </div>
      </div>
    </EmbedWrapper>
  )
}

/** Non-HM-link variant: shows site favicon or blue-globe fallback and link text. */
function ExternalLinkEmbed({
  url,
  parentBlockId,
  openOnClick,
}: {
  url: string
  parentBlockId: string | null
  openOnClick: boolean
}) {
  const domain = useMemo(() => safeUrlHostname(url), [url])
  const [faviconFailed, setFaviconFailed] = useState(false)
  // Try the site's own favicon directly via <img> tag
  const faviconSrc = domain ? `https://${domain}/favicon.ico` : null
  const linkText = domain || url
  const link = useRouteLink(url)
  const sharedAttrs = {
    'data-content-type': 'embed',
    'data-url': url,
    'data-view': 'Link',
    'data-parent-block-id': parentBlockId ?? undefined,
  }
  const icon =
    faviconSrc && !faviconFailed ? (
      <img src={faviconSrc} alt="" className="size-5 shrink-0" onError={() => setFaviconFailed(true)} />
    ) : (
      <Globe className="size-5 shrink-0 text-blue-600 dark:text-blue-400" />
    )

  if (openOnClick) {
    // Published view - whole row navigates.
    return (
      <a
        {...sharedAttrs}
        href={link.href}
        onClick={link.onClick}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'hover:bg-accent dark:hover:bg-accent flex w-full items-center gap-3 overflow-hidden rounded-lg',
          'bg-white shadow-md transition-colors duration-300 dark:bg-black',
          'px-3 py-2 no-underline',
        )}
      >
        {icon}
        <div className="min-w-0 flex-1 overflow-hidden">
          <span className="line-clamp-2 max-w-full text-base font-bold text-blue-600 dark:text-blue-400">
            {linkText}
          </span>
        </div>
      </a>
    )
  }
  // Edit mode - only the title text navigates, the rest stays selectable.
  return (
    <div
      {...sharedAttrs}
      className={cn(
        'hover:bg-accent dark:hover:bg-accent flex w-full items-center gap-3 overflow-hidden rounded-lg',
        'bg-white shadow-md transition-colors duration-300 dark:bg-black',
        'px-3 py-2',
      )}
    >
      {icon}
      <div className="min-w-0 flex-1 overflow-hidden">
        <a
          href={link.href}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            link.onClick?.(e)
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 max-w-full text-base font-bold text-blue-600 no-underline hover:underline dark:text-blue-400"
        >
          {linkText}
        </a>
      </div>
    </div>
  )
}

function safeUrlHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/** Renders full embedded document or comment content. */
function CyclicEmbedBlock({entityLabel}: {entityLabel: 'document' | 'comment'}) {
  return (
    <ErrorBlock
      message={
        entityLabel === 'comment'
          ? 'This comment can’t embed itself. Link to it instead.'
          : 'This embed would create a recursive loop. Try linking to it instead, or embed an older version.'
      }
    />
  )
}

export function BlockEmbedContent({
  block,
  depth,
  parentBlockId,
  openOnClick = true,
  renderDocumentContent,
}: BlockContentProps<HMBlockEmbed> & {
  openOnClick?: boolean
  renderDocumentContent?: (props: {
    embedBlocks: HMBlockNode[]
    document: HMDocument | null | undefined
    id: UnpackedHypermediaId
    rootChildrenType?: HMBlockChildrenType
    /** Block id within the embedded document to scroll-anchor / focus-highlight. */
    blockRef?: string | null
    /** Codepoint range within `blockRef` to highlight when the link targets a fragment. */
    blockRange?: import('@seed-hypermedia/client/hm-types').BlockRange | null
  }) => React.ReactNode
}) {
  const [showReferenced, setShowReferenced] = useState(false)
  const renderResourceStack = useRenderResourceStack()
  // Memoize on `block.link` so `id` (and `id.blockRange`) keep a stable reference
  // across re-renders — otherwise every render hands `BlockEmbedContentDocument`
  // a fresh `blockRange` prop, re-rendering it needlessly.
  const id = useMemo(() => {
    const rawId = unpackHmId(block.link)
    // When the link targets a specific codepoint range we MUST resolve against
    // the pinned version, otherwise later edits to the source doc shift the
    // range and the highlight lands on different text. Force `latest:false`
    // whenever blockRange is present, even on legacy links that still carry `&l`.
    return rawId && rawId.blockRange && rawId.version ? {...rawId, latest: false} : rawId
  }, [block.link])

  const resource = useResource(id, {subscribed: true})
  // Check tombstone on latest version for version-pinned embeds.
  // Version-specific fetches skip the backend's tombstone check.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : null
  const latestCheck = useResource(latestCheckId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const comment = resource.data?.type === 'comment' ? resource.data.comment : undefined
  const commentTargetResource = useResource(getCommentTargetId(comment))
  const author = useAccount(comment?.author, {subscribe: true})
  const candidateKind = comment ? 'comment' : document ? 'document' : null
  const isCyclicEmbed = !!(
    id &&
    candidateKind &&
    shouldBlockEmbeddedResource(renderResourceStack, {kind: candidateKind, id})
  )

  const isDeleted =
    resource.isTombstone ||
    resource.data?.type === 'tombstone' ||
    latestCheck.data?.type === 'tombstone' ||
    latestCheck.isTombstone

  if (!id) return <ErrorBlock message="Invalid embed link" />
  if (isCyclicEmbed) return <CyclicEmbedBlock entityLabel={candidateKind || 'document'} />
  // No content available at all — banner without toggle
  if (resource.data?.type === 'tombstone') {
    return <DeletedEmbedBanner />
  }
  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return (
        <div className="block-content border-border bg-muted/30 flex items-center gap-2 rounded-md border p-4">
          <Spinner className="size-4" />
          <SizableText className="text-muted-foreground">Looking for this content…</SizableText>
        </div>
      )
    }
    return (
      <ErrorBlock message="Resource not found">
        <Button
          variant="destructive"
          onClick={() => {
            copyUrlToClipboardWithFeedback(block.link, 'Missing Resource')
          }}
        >
          Copy Link
        </Button>
      </ErrorBlock>
    )
  }
  if (resource.data?.type === 'error') {
    return <ErrorBlock message={resource.data.message} />
  }
  if (resource.isError || (!resource.isLoading && !resource.data)) {
    return <ErrorBlock message="Could not load embed" />
  }
  if (comment) {
    // Detect stale version for version-pinned comment embeds
    const latestComment = latestCheck.data?.type === 'comment' ? latestCheck.data.comment : undefined
    const isStaleCommentVersion = !!(latestComment && comment.version !== latestComment.version)

    const commentContent = (
      <BlockEmbedContentComment
        parentBlockId={parentBlockId}
        depth={depth}
        block={block}
        id={id}
        comment={comment}
        isLoading={resource.isLoading}
        targetResource={commentTargetResource.data ?? undefined}
        author={author.data}
        isAuthorLoading={author.isLoading}
        openOnClick={openOnClick}
        isStaleVersion={isStaleCommentVersion}
      />
    )
    if (isDeleted) {
      return <DeletedEmbedBanner entityLabel="comment">{commentContent}</DeletedEmbedBanner>
    }
    return commentContent
  }

  const embedContent = (
    <BlockEmbedContentDocument
      id={id}
      depth={depth}
      viewType={block.attributes?.view}
      blockId={block.id}
      blockRef={id.blockRef}
      blockRange={id.blockRange}
      isLoading={resource.isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={document}
      parentBlockId={parentBlockId}
      renderOpenButton={() => null}
      openOnClick={openOnClick}
      renderDocumentContent={renderDocumentContent}
    />
  )

  if (isDeleted) {
    return <DeletedEmbedBanner>{embedContent}</DeletedEmbedBanner>
  }

  return embedContent
}

/** Renders embedded comments section for a document. */
export function BlockEmbedComments({
  parentBlockId,
  block,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {openOnClick?: boolean}) {
  const client = useUniversalClient()
  const id = unpackHmId(block.link)
  const renderResourceStack = useRenderResourceStack()

  const resource = useResource(id, {
    recursive: true,
    subscribed: true,
  })
  // Check tombstone on latest version for version-pinned embeds.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : null
  const latestCheck = useResource(latestCheckId)

  if (!id) {
    return <ErrorBlock message="Invalid embed link" />
  }
  if (shouldBlockEmbeddedResource(renderResourceStack, {kind: 'document', id})) {
    return <CyclicEmbedBlock entityLabel="document" />
  }
  // No content available at all — banner without toggle
  if (resource.data?.type === 'tombstone') {
    return <DeletedEmbedBanner />
  }

  const isDeleted = resource.isTombstone || latestCheck.data?.type === 'tombstone' || latestCheck.isTombstone
  const CommentEditor = client.CommentEditor

  const content = (
    <EmbedWrapper id={id} parentBlockId={parentBlockId} hideBorder openOnClick={openOnClick}>
      <RenderResourceProvider resource={{kind: 'document', id}}>
        {CommentEditor ? (
          <div
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <CommentEditor docId={id} />
          </div>
        ) : null}
        <Discussions targetId={id} />
      </RenderResourceProvider>
    </EmbedWrapper>
  )

  if (isDeleted) {
    return <DeletedEmbedBanner>{content}</DeletedEmbedBanner>
  }

  return content
}

/** Info banner for version-pinned comment embeds whose content has changed since embedding. */
export function BlockEmbedContentComment({
  id,
  parentBlockId,
  depth,
  comment,
  author,
  isAuthorLoading = false,
  block,
  targetResource,
  openOnClick = true,
  isStaleVersion = false,
}: {
  id: UnpackedHypermediaId
  parentBlockId: string | null
  depth: number | undefined
  block: HMBlockEmbed
  isLoading?: boolean
  comment: HMComment
  author: HMMetadataPayload | null | undefined
  isAuthorLoading?: boolean
  targetResource: HMResource | undefined
  openOnClick?: boolean
  isStaleVersion?: boolean
}) {
  const currentRoute = useNavRoute()
  const targetDocId = getCommentTargetId(comment)
  const activePanel = getRoutePanel(currentRoute) as DocumentPanelRoute | null

  const route = useMemo(() => {
    if (!targetDocId) return undefined

    if (activePanel) {
      return {
        key: 'document' as const,
        id: targetDocId,
        panel: activePanel,
      }
    }
    return {
      key: 'comments' as const,
      id: targetDocId,
      openComment: comment.id,
    }
  }, [targetDocId, activePanel, comment.id])

  return (
    <EmbedWrapper
      viewType={block.attributes?.view}
      depth={depth || 0}
      id={id}
      parentBlockId={parentBlockId || ''}
      openOnClick={openOnClick}
      route={route}
    >
      <CommentEmbedHeader
        comment={comment}
        author={author}
        isAuthorLoading={isAuthorLoading}
        targetResource={targetResource}
        isStaleVersion={isStaleVersion}
      />
      <CommentContent
        comment={comment}
        resourceId={id}
        zoomBlockRef={id.blockRef}
        allowHighlight={false}
        openOnClick={openOnClick}
      />
    </EmbedWrapper>
  )
}

/** Header for embedded comment showing author info and target document link. */
function CommentEmbedHeader({
  comment,
  author,
  isAuthorLoading = false,
  targetResource,
  isStaleVersion = false,
}: {
  comment: HMComment
  author: HMMetadataPayload | null | undefined
  isAuthorLoading?: boolean
  targetResource: HMResource | undefined
  isStaleVersion?: boolean
}) {
  const authorName = author?.metadata?.name || abbreviateUid(comment.author) || '?'
  const authorIcon = author?.metadata?.icon
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap justify-between p-3">
        <div className="flex items-center gap-2">
          <HMIcon size={24} id={author?.id || hmId(comment.author)} name={authorName} icon={authorIcon} />
          <SizableText weight="bold">{authorName}</SizableText>
          {isAuthorLoading && !author?.metadata?.name ? <Spinner size="small" /> : null}
          {targetResource && targetResource.type === 'document' ? (
            <>
              {' on '}
              <DocumentNameLink metadata={targetResource.document?.metadata} id={targetResource.id} />
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {comment.createTime ? (
            <SizableText size="sm" color="muted">
              {formattedDateMedium(comment.createTime)}
            </SizableText>
          ) : null}
          {JSON.stringify(comment.createTime) !== JSON.stringify(comment.updateTime) ? (
            <SizableText size="xs" className="text-muted-foreground">
              (edited)
            </SizableText>
          ) : null}
        </div>
      </div>
      {isStaleVersion ? (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 dark:border-blue-600 dark:bg-blue-900/30">
          <AlertCircle className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
          <SizableText size="xs" className="text-blue-800 dark:text-blue-200">
            This is an older version — the comment has been edited since it was embedded
          </SizableText>
        </div>
      ) : null}
    </div>
  )
}

/** Internal component rendering embedded document content with block ref/range support. */
function BlockEmbedContentDocument(props: {
  depth: number | undefined
  blockId: string
  blockRef: string | null
  blockRange: BlockRange | null
  isLoading: boolean
  id: UnpackedHypermediaId
  document: HMDocument | null | undefined
  showReferenced: boolean
  onShowReferenced: (showReference: boolean) => void
  renderOpenButton: () => React.ReactNode
  parentBlockId: string | null
  viewType?: HMEmbedView
  openOnClick?: boolean
  renderDocumentContent?: (props: {
    embedBlocks: HMBlockNode[]
    document: HMDocument | null | undefined
    id: UnpackedHypermediaId
    rootChildrenType?: HMBlockChildrenType
    blockRef?: string | null
    blockRange?: BlockRange | null
  }) => React.ReactNode
}) {
  const {
    id,
    blockId,
    isLoading,
    document,
    showReferenced,
    onShowReferenced,
    renderOpenButton,
    parentBlockId,
    viewType,
    openOnClick,
  } = props
  const navigate = useNavigate()

  const blockRangeStart = props.blockRange && 'start' in props.blockRange ? props.blockRange.start : null
  const blockRangeEnd = props.blockRange && 'end' in props.blockRange ? props.blockRange.end : null
  const blockRangeExpanded = props.blockRange && 'expanded' in props.blockRange ? props.blockRange.expanded : false

  const embedData = useMemo(() => {
    const selectedBlock =
      props.blockRef && document?.content ? getBlockNodeById(document.content, props.blockRef) : null

    const embedBlocks = props.blockRef
      ? selectedBlock
        ? [
            {
              ...selectedBlock,
              children: blockRangeExpanded ? [...(selectedBlock.children || [])] : [],
            },
          ]
        : null
      : document?.content
    let res = {
      ...document,
      data: {
        document,
        embedBlocks,
        blockRange:
          blockRangeStart != null && blockRangeEnd != null && selectedBlock
            ? {
                blockId: props.blockRef,
                start: blockRangeStart,
                end: blockRangeEnd,
              }
            : null,
      },
    }
    return res
  }, [props.blockRef, blockRangeStart, blockRangeEnd, blockRangeExpanded, document?.version])

  const embedOnBlockSelect = useCallback(
    (blockId: string, opts?: BlockRange & {copyToClipboard?: boolean}): boolean => {
      if (!openOnClick) return false
      if (opts?.copyToClipboard) {
        toast.error('Error: not implemented')
        return false
      }
      navigate({
        key: 'document',
        id: {
          ...id,
          blockRef: blockId || null,
        },
      })
      return true
    },
    [navigate, id],
  )

  let content: null | JSX.Element = <ErrorBlock message="Unknown error" />
  if (isLoading) {
    content = <Spinner />
  } else if (embedData.data.embedBlocks) {
    if (props.renderDocumentContent) {
      content = (
        <>
          {props.renderDocumentContent({
            embedBlocks: embedData.data.embedBlocks as HMBlockNode[],
            document,
            id,
            rootChildrenType: props.blockRef ? 'Group' : document?.metadata?.childrenType,
            blockRef: props.blockRef,
            blockRange: props.blockRange ?? null,
          })}
        </>
      )
    } else {
      content = (
        <EmbedContentFallback
          embedBlocks={embedData.data.embedBlocks as HMBlockNode[]}
          document={document}
          id={id}
          blockId={blockId}
          blockRef={props.blockRef}
          blockRange={props.blockRange ?? null}
          onCopyBlockLink={(bid) => {
            embedOnBlockSelect(bid, {copyToClipboard: true, start: 0, end: 0})
          }}
          showReferenced={showReferenced}
          onShowReferenced={onShowReferenced}
        />
      )
    }
  } else if (props.blockRef) {
    return (
      <ErrorBlock message={`Block #${props.blockRef} was not found in this version`}>
        <div className="flex gap-2 p-4">
          {id.version ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onShowReferenced(true)
              }}
            >
              Show Referenced Version
            </Button>
          ) : null}
          {renderOpenButton()}
        </div>
      </ErrorBlock>
    )
  }
  return (
    <EmbedWrapper
      route={{key: 'document', id}}
      viewType={viewType}
      depth={props.depth || 1}
      id={id}
      parentBlockId={parentBlockId || ''}
      isRange={!!props.blockRange && ('start' in props.blockRange || 'end' in props.blockRange)}
      openOnClick={openOnClick}
    >
      {content}
    </EmbedWrapper>
  )
}

/** Fallback renderer for embedded document content using ReadOnlyViewer instead of BlocksContent. */
function EmbedContentFallback({
  embedBlocks,
  document,
  id,
  blockId,
  blockRef,
  blockRange,
  onCopyBlockLink,
  showReferenced,
  onShowReferenced,
}: {
  embedBlocks: HMBlockNode[]
  document: HMDocument | null | undefined
  id: UnpackedHypermediaId
  blockId: string
  blockRef: string | null
  /** Codepoint range to highlight inside `blockRef`. Absent ⇒ whole block. */
  blockRange?: BlockRange | null
  onCopyBlockLink?: (blockId: string) => void
  showReferenced: boolean
  onShowReferenced: (show: boolean) => void
}) {
  const Viewer = useReadOnlyViewer()

  const blocks = useMemo(() => {
    if (!blockRef && document?.metadata?.name) {
      // Wrap content in a synthetic heading block (mirrors the old BlockNodeContent heading)
      const headingBlock: HMBlockNode = {
        block: {
          type: 'Heading',
          id: blockId,
          text: getDocumentTitle(document) || '',
          attributes: {childrenType: 'Group'},
          annotations: [],
        },
        children: embedBlocks,
      }
      return [headingBlock]
    }
    return embedBlocks
  }, [blockRef, document, blockId, embedBlocks])

  if (!Viewer) return null

  // Only forward a codepoint range — `{expanded: true}` should not highlight.
  const fragmentRange =
    blockRange && 'start' in blockRange && 'end' in blockRange && typeof blockRange.start === 'number'
      ? blockRange
      : undefined

  return (
    <>
      <Viewer
        blocks={blocks}
        resourceId={id}
        onCopyBlockLink={onCopyBlockLink}
        focusBlockId={blockRef && fragmentRange ? blockRef : undefined}
        blockRange={fragmentRange}
      />
      {showReferenced ? (
        <div className="flex justify-end">
          <Tooltip content="The latest reference was not found. Click to try again.">
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onShowReferenced(false)
              }}
            >
              <Undo2 className="size-3" />
              Back to Reference
            </Button>
          </Tooltip>
        </div>
      ) : null}
    </>
  )
}
