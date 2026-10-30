import type {
  HMBlockChildrenType,
  HMBlockNode,
  HMEmbedView,
  HMMetadata,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import type {NavRoute, RenderResourceKind} from '@shm/shared'
import {commentIdToHmId, packHmId} from '@shm/shared'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {CommentContentContext, useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {AlertCircle, Play} from 'lucide-react'
import {useContext, useMemo, useState} from 'react'
import {AccountIdentity} from './account-avatar'
import {getBlockFragment, getBlockNodeById, getPlainTextQuote} from './blocks-content-utils'
import {EmbedWrapper, FragmentEmbedControls} from './embed-wrapper'
import {Tooltip} from './tooltip'
import {cn} from './utils'
import {isIpfsUrl, useImageUrl, useFileProxyUrl} from './get-file-url'

/** Maps the URL selection to an embed, including offsets within a collapsed fragment. */
export function getContentEmbedHighlight(
  id: UnpackedHypermediaId,
  route: NavRoute,
  resourceKind: RenderResourceKind,
  collapsed: boolean,
): {focusBlockId?: string; blockRange?: {start: number; end: number}} {
  const selectedId =
    resourceKind === 'comment'
      ? route.key === 'comments' && route.openComment
        ? {...commentIdToHmId(route.openComment), blockRef: route.blockId, blockRange: route.blockRange}
        : null
      : route.key === 'document' || (route.key === 'comments' && !route.openComment)
        ? route.id
        : null
  if (!selectedId || selectedId.id !== id.id || !selectedId.blockRef) return {}
  if (collapsed && selectedId.blockRef !== id.blockRef) return {}

  const range = selectedId.blockRange
  if (range && typeof range.start === 'number' && typeof range.end === 'number') {
    const offset = collapsed && typeof id.blockRange?.start === 'number' ? id.blockRange.start : 0
    const limit = collapsed && typeof id.blockRange?.end === 'number' ? id.blockRange.end : Infinity
    const start = Math.max(range.start, offset)
    const end = Math.min(range.end, limit)
    if (end <= start) return {}
    return {focusBlockId: selectedId.blockRef, blockRange: {start: start - offset, end: end - offset}}
  }
  return {focusBlockId: selectedId.blockRef}
}

/** Content, block, and fragment presentation shared by embeds and reply quotes. */
export function ContentEmbed({
  id,
  blocks,
  route,
  parentBlockId = null,
  viewType = 'Content',
  openOnClick = true,
  rootChildrenType,
  title,
  identity,
  expandTo = 'block',
  sourceLabel = 'block',
  resourceKind = 'document',
  isStaleVersion = false,
}: {
  id: UnpackedHypermediaId
  blocks: HMBlockNode[]
  route?: NavRoute
  parentBlockId?: string | null
  viewType?: HMEmbedView
  openOnClick?: boolean
  rootChildrenType?: HMBlockChildrenType
  title?: string
  identity?: {id: UnpackedHypermediaId; name?: string; icon?: HMMetadata['icon']; loading?: boolean}
  expandTo?: 'block' | 'resource'
  sourceLabel?: 'block' | 'comment'
  resourceKind?: RenderResourceKind
  isStaleVersion?: boolean
}) {
  const inComment = useContext(CommentContentContext)
  const Viewer = useReadOnlyViewer()
  const currentRoute = useNavRoute()
  const sourceKey = packHmId(id)
  const [expansion, setExpansion] = useState({sourceKey, expanded: false})
  if (expansion.sourceKey !== sourceKey) {
    setExpansion({sourceKey, expanded: false})
  }
  const expanded = expansion.sourceKey === sourceKey && expansion.expanded
  const selectedBlock = useMemo(
    () => (id.blockRef ? getBlockNodeById(blocks, id.blockRef) : null),
    [blocks, id.blockRef],
  )
  const fragment = useMemo(
    () => (selectedBlock ? getBlockFragment(selectedBlock, id.blockRange) : null),
    [selectedBlock, id.blockRange],
  )
  const quote = useMemo(() => {
    if (fragment) return getPlainTextQuote(fragment)
    if (selectedBlock && (!id.blockRange || 'expanded' in id.blockRange)) {
      const textQuote = getPlainTextQuote(selectedBlock)
      if (textQuote || !inComment) return textQuote
      return {
        block: {
          id: selectedBlock.block.id,
          type: 'Paragraph' as const,
          text: selectedBlock.block.type,
          attributes: {},
          annotations: [],
        },
        children: [],
      }
    }
    if (resourceKind !== 'comment' || id.blockRef || !blocks.length) return null
    const text: string[] = []
    function collectText(nodes: HMBlockNode[]) {
      for (const node of nodes) {
        if ('text' in node.block && node.block.text) text.push(node.block.text)
        if (node.children) collectText(node.children)
      }
    }
    collectText(blocks)
    return {
      block: {
        id: blocks[0]!.block.id,
        type: 'Paragraph' as const,
        text: text.join(' ') || 'Comment',
        attributes: {},
        annotations: [],
      },
      children: [],
    }
  }, [fragment, selectedBlock, id.blockRange, id.blockRef, resourceKind, blocks, inComment])
  const collapsed = inComment && !!quote && !expanded
  const media =
    selectedBlock?.block.type === 'Image' || selectedBlock?.block.type === 'Video' ? selectedBlock.block : null
  const imageUrl = useImageUrl()
  const fileUrl = useFileProxyUrl()
  const mediaUrl = media?.link
    ? isIpfsUrl(media.link)
      ? media.type === 'Image'
        ? imageUrl(media.link)
        : fileUrl(media.link)
      : media.link
    : ''
  const displayedBlocks = useMemo(() => {
    if (collapsed) return [quote!]
    if (quote && expanded && expandTo === 'resource') return blocks
    if (!selectedBlock) return blocks
    const includeChildren =
      expandTo === 'resource' || !!(id.blockRange && 'expanded' in id.blockRange && id.blockRange.expanded)
    return [{...selectedBlock, children: includeChildren ? selectedBlock.children : []}]
  }, [blocks, selectedBlock, id.blockRange, quote, collapsed, expanded, expandTo])
  const highlight =
    expanded && fragment && id.blockRef && id.blockRange
      ? {focusBlockId: id.blockRef, blockRange: id.blockRange}
      : getContentEmbedHighlight(id, currentRoute, resourceKind, collapsed)
  const author = identity ? (
    <span className="inline-flex items-center gap-1 align-baseline">
      <AccountIdentity
        {...identity}
        variant={collapsed ? 'compact' : 'regular'}
        className={collapsed ? 'leading-5' : undefined}
      />
      {isStaleVersion ? (
        <Tooltip content="This comment has been edited since it was embedded." asChild>
          <span tabIndex={0} aria-label="Older comment version">
            <AlertCircle className="size-3" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  ) : undefined

  const content = (
    <EmbedWrapper
      id={id}
      route={route}
      parentBlockId={parentBlockId}
      viewType={viewType}
      openOnClick={openOnClick}
      isRange={!!quote}
    >
      <div
        className={cn(
          'min-w-0 px-2',
          quote && inComment && 'pr-8',
          collapsed &&
            'flex items-center gap-1 font-sans text-xs leading-5 whitespace-nowrap [--embed-white-space:nowrap]',
        )}
      >
        {collapsed && author ? (
          <span className="flex max-w-1/2 shrink-0 items-center overflow-hidden">{author}</span>
        ) : null}
        {!collapsed && author ? <div className="mb-1 flex items-center">{author}</div> : null}
        {!id.blockRef && title ? <div className="mb-1 font-sans text-sm font-semibold">{title}</div> : null}
        {id.blockRef && !selectedBlock ? (
          <p className="text-muted-foreground text-sm" role="status">
            The referenced block was not found in this version.
          </p>
        ) : media && !collapsed ? (
          <div className="embed-media-container">
            <div
              className={cn(
                'embed-media-preview bg-primary/5 relative overflow-hidden rounded-sm p-2',
                media.type === 'Video' && 'embed-media-video',
              )}
            >
              {media.type === 'Image' ? (
                <img
                  src={mediaUrl}
                  alt={media.text || media.attributes?.name || 'Embedded image'}
                  className="pointer-events-none block h-auto max-h-56 max-w-full object-contain"
                />
              ) : (
                <div
                  className="bg-muted relative flex aspect-video max-h-56 items-center justify-center"
                  aria-label={media.attributes?.name || 'Open video source'}
                >
                  {isIpfsUrl(media.link) ? (
                    <video
                      src={mediaUrl}
                      preload="metadata"
                      muted
                      playsInline
                      tabIndex={-1}
                      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                    />
                  ) : null}
                  <Play className="text-foreground relative size-8" aria-hidden="true" />
                </div>
              )}
            </div>
          </div>
        ) : Viewer ? (
          <div className={collapsed ? 'min-w-0 flex-1 truncate' : undefined}>
            <Viewer
              blocks={displayedBlocks}
              resourceId={id}
              resourceKind={resourceKind}
              commentStyle={resourceKind === 'comment'}
              rootChildrenType={id.blockRef ? 'Group' : rootChildrenType}
              embedded
              presentation={collapsed ? 'fragment' : 'content'}
              {...highlight}
            />
          </div>
        ) : null}
      </div>
    </EmbedWrapper>
  )
  if (!quote || !inComment) return content
  return (
    <FragmentEmbedControls
      expanded={expanded}
      onExpandedChange={(expanded) => setExpansion({sourceKey, expanded})}
      sourceLabel={sourceLabel}
    >
      {content}
    </FragmentEmbedControls>
  )
}
