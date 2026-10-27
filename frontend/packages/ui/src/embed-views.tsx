import type {HMResource} from '@seed-hypermedia/client/hm-types'
import {
  HMBlock,
  HMBlockEmbed,
  HMComment,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  abbreviateUid,
  getCommentTargetId,
  getDocumentTitle,
  getRoutePanel,
  RenderResourceProvider,
  shouldBlockEmbeddedResource,
  useRenderResourceStack,
  useRouteLink,
  useUniversalClient,
} from '@shm/shared'
import {commentThreadSelection} from '@shm/shared/comments'
import {useAccount, useResolvedHmId, useResource, useResources} from '@shm/shared/models/entity'
import type {DocumentPanelRoute} from '@shm/shared/routes'
import {isHmDescendantOf} from '@shm/shared/utils/breadcrumbs'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {AlertCircle, FileSymlink as FileSymlinkIcon, FileText as FileTextIcon, Globe} from 'lucide-react'
import React, {ReactNode, useMemo, useState} from 'react'
import {Button} from './button'
import {Discussions} from './comments'
import {ContentEmbed} from './content-embed'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {EmbedWrapper, getEmbedDocumentRoute} from './embed-wrapper'
import {DocumentCard} from './newspaper'
import {useSpaceSettings} from './space-settings'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

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
        <SizableText className="flex-1 font-sans text-sm text-amber-800 dark:text-amber-200">
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
  const resolved = useResolvedHmId(block.link)
  const id = resolved.id ?? undefined
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
  if (resolved.error) return <ErrorBlock message={`Could not resolve embed: ${String(resolved.error)}`} />
  if (resolved.isLoading || doc.isInitialLoading)
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
          <SizableText className="text-muted-foreground font-sans">Looking for this content…</SizableText>
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
  const resolved = useResolvedHmId(url)
  const id = resolved.id
  if (resolved.isLoading) return <Spinner />
  if (resolved.error) return <ErrorBlock message={`Could not resolve embed: ${String(resolved.error)}`} />
  const isHm = !!id

  if (isHm && id) {
    return <HmLinkEmbed id={id} parentBlockId={parentBlockId} openOnClick={openOnClick} />
  }
  return <ExternalLinkEmbed url={url} parentBlockId={parentBlockId} openOnClick={openOnClick} />
}

/** HM-link variant: a small document tile (subdoc vs cross-doc icon) and the target
 *  document's live title as link text. */
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
  const Icon = isHmDescendantOf(id, parentDocId) ? FileTextIcon : FileSymlinkIcon
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
      <div className="flex w-full items-center gap-2 overflow-hidden">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 dark:bg-emerald-900/30">
          <Icon className="size-4 text-emerald-700 dark:text-emerald-400" strokeWidth={1.75} />
        </div>
        {titleIsLink ? (
          <a
            href={titleLink.href}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              titleLink.onClick?.(e)
            }}
            className={linkViewTextClass}
          >
            {title}
          </a>
        ) : (
          <span className={linkViewTextClass}>{title}</span>
        )}
      </div>
    </EmbedWrapper>
  )
}

/** Non-HM-link variant: the site's favicon (or a globe) and the link's domain as link text. */
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
  const faviconSrc = domain ? `https://${domain}/favicon.ico` : null
  const linkText = domain || url
  const link = useRouteLink(url)
  return (
    <div
      data-content-type="embed"
      data-url={url}
      data-view="Link"
      data-parent-block-id={parentBlockId ?? undefined}
      className="flex w-full items-center gap-2 overflow-hidden"
    >
      {faviconSrc && !faviconFailed ? (
        <img src={faviconSrc} alt="" className="size-4 shrink-0" onError={() => setFaviconFailed(true)} />
      ) : (
        <Globe className="text-link size-4 shrink-0" />
      )}
      <a
        href={link.href}
        // In the editor only the text navigates, so the rest of the block stays selectable.
        onMouseDown={openOnClick ? undefined : (e) => e.stopPropagation()}
        onClick={(e) => {
          if (!openOnClick) e.stopPropagation()
          link.onClick?.(e)
        }}
        target="_blank"
        rel="noopener noreferrer"
        className={linkViewTextClass}
      >
        {linkText}
      </a>
    </div>
  )
}

/** Link view text styled like an inline hyperlink in the document body. */
const linkViewTextClass = 'link text-link hover:text-link-hover line-clamp-2 max-w-full'

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
}: BlockContentProps<HMBlockEmbed> & {
  openOnClick?: boolean
}) {
  const renderResourceStack = useRenderResourceStack()
  // Memoize on `block.link` so `id` (and `id.blockRange`) keep a stable reference
  // across re-renders so the shared content presentation has a stable source.
  const resolved = useResolvedHmId(block.link)
  const id = useMemo(() => {
    const rawId = resolved.id
    // When the link targets a specific codepoint range we MUST resolve against
    // the pinned version, otherwise later edits to the source doc shift the
    // range and the highlight lands on different text. Force `latest:false`
    // whenever blockRange is present, even on legacy links that still carry `&l`.
    return rawId && rawId.blockRange && rawId.version ? {...rawId, latest: false} : rawId
  }, [resolved.id])

  const resource = useResource(id, {subscribed: true})
  // Check tombstone on latest version for version-pinned embeds.
  // Version-specific fetches skip the backend's tombstone check.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : null
  const latestCheck = useResource(latestCheckId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const comment = resource.data?.type === 'comment' ? resource.data.comment : undefined
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

  if (resolved.isLoading) return <Spinner />
  if (resolved.error) return <ErrorBlock message={`Could not resolve embed: ${String(resolved.error)}`} />
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
          <SizableText className="text-muted-foreground font-sans">Looking for this content…</SizableText>
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
        key={block.link}
        parentBlockId={parentBlockId}
        depth={depth}
        block={block}
        id={id}
        comment={comment}
        isLoading={resource.isLoading}
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

  const embedContent = resource.isLoading ? (
    <Spinner />
  ) : document ? (
    <ContentEmbed
      key={block.link}
      id={id}
      blocks={document.content}
      route={{key: 'document', id}}
      viewType={block.attributes?.view}
      parentBlockId={parentBlockId}
      openOnClick={openOnClick}
      rootChildrenType={document.metadata?.childrenType}
      title={getDocumentTitle(document)}
    />
  ) : (
    <ErrorBlock message="Could not load embed" />
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
  const resolved = useResolvedHmId(block.link)
  const id = resolved.id
  const renderResourceStack = useRenderResourceStack()

  const resource = useResource(id, {
    recursive: true,
    subscribed: true,
  })
  // Check tombstone on latest version for version-pinned embeds.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : null
  const latestCheck = useResource(latestCheckId)
  // The comments belong to the embedded document, so its own space decides
  // whether new conversations can start here.
  const {showConversations} = useSpaceSettings(id?.uid)

  if (resolved.isLoading) return <Spinner />
  if (resolved.error) return <ErrorBlock message={`Could not resolve embed: ${String(resolved.error)}`} />
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
  const CommentEditor = showConversations ? client.CommentEditor : undefined

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
  comment,
  author,
  isAuthorLoading = false,
  block,
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
  targetResource?: HMResource
  openOnClick?: boolean
  isStaleVersion?: boolean
}) {
  const currentRoute = useNavRoute()
  const targetDocId = getCommentTargetId(comment)
  const activePanel = getRoutePanel(currentRoute) as DocumentPanelRoute | null
  const route = useMemo(() => {
    if (!targetDocId) return undefined

    if (id.blockRef) {
      return {
        key: 'comments' as const,
        id: {...targetDocId, blockRef: id.blockRef, blockRange: id.blockRange},
        openComment: comment.id,
        openCommentVersion: id.version || comment.version,
        blockId: id.blockRef,
        blockRange: id.blockRange,
        panel:
          activePanel?.key === 'activity' || activePanel?.key === 'collaborators' || activePanel?.key === 'directory'
            ? activePanel
            : undefined,
      }
    }
    const documentId =
      currentRoute.key === 'document' && currentRoute.id.id === targetDocId.id
        ? {...currentRoute.id, blockRef: null, blockRange: null}
        : targetDocId
    return {
      key: 'document' as const,
      id: documentId,
      panel: {key: 'comments' as const, id: documentId, ...commentThreadSelection(comment)},
    }
  }, [targetDocId, activePanel, comment, id, currentRoute])

  return (
    <ContentEmbed
      id={id}
      blocks={comment.content}
      route={route}
      parentBlockId={parentBlockId}
      viewType={block.attributes?.view}
      openOnClick={openOnClick}
      resourceKind="comment"
      expandTo="resource"
      sourceLabel="comment"
      identity={{
        id: author?.id || hmId(comment.author),
        name: author?.metadata?.name,
        icon: author?.metadata?.icon,
        loading: isAuthorLoading,
      }}
      isStaleVersion={isStaleVersion}
    />
  )
}
