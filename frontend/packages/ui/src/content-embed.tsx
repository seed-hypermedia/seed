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
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {AlertCircle} from 'lucide-react'
import {useMemo, useState} from 'react'
import {AccountIdentity} from './account-avatar'
import {getBlockFragment, getBlockNodeById} from './blocks-content-utils'
import {EmbedWrapper, FragmentEmbedControls} from './embed-wrapper'
import {Tooltip} from './tooltip'
import {cn} from './utils'

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
  const collapsed = !!fragment && !expanded
  const displayedBlocks = useMemo(() => {
    if (collapsed) return [fragment!]
    if (fragment && expanded && expandTo === 'resource') return blocks
    if (!selectedBlock) return blocks
    const includeChildren =
      expandTo === 'resource' || !!(id.blockRange && 'expanded' in id.blockRange && id.blockRange.expanded)
    return [{...selectedBlock, children: includeChildren ? selectedBlock.children : []}]
  }, [blocks, selectedBlock, id.blockRange, fragment, collapsed, expanded, expandTo])
  const highlight = getContentEmbedHighlight(id, currentRoute, resourceKind, collapsed)
  const author = identity ? (
    <span className="inline-flex items-center gap-1 align-baseline">
      <AccountIdentity {...identity} variant={collapsed ? 'compact' : 'regular'} />
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
      isRange={!!fragment}
    >
      <div className={cn('min-w-0 px-2', fragment && 'pr-8')}>
        {!collapsed && author ? <div className="mb-1 flex items-center">{author}</div> : null}
        {!id.blockRef && title ? <div className="mb-1 font-sans text-sm font-semibold">{title}</div> : null}
        {id.blockRef && !selectedBlock ? (
          <p className="text-muted-foreground text-sm" role="status">
            The referenced block was not found in this version.
          </p>
        ) : Viewer ? (
          <Viewer
            blocks={displayedBlocks}
            resourceId={id}
            resourceKind={resourceKind}
            commentStyle={resourceKind === 'comment'}
            rootChildrenType={id.blockRef ? 'Group' : rootChildrenType}
            embedded
            presentation={collapsed ? 'fragment' : 'content'}
            inlinePrefix={collapsed ? author : undefined}
            {...highlight}
          />
        ) : null}
      </div>
    </EmbedWrapper>
  )
  if (!fragment) return content
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
