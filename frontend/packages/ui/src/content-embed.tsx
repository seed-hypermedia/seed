import type {
  HMBlockChildrenType,
  HMBlockNode,
  HMEmbedView,
  HMMetadata,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import type {NavRoute, RenderResourceKind} from '@shm/shared'
import {packHmId} from '@shm/shared'
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {AlertCircle} from 'lucide-react'
import {useMemo, useState} from 'react'
import {AccountIdentity} from './account-avatar'
import {getBlockFragment, getBlockNodeById} from './blocks-content-utils'
import {EmbedWrapper, FragmentEmbedControls} from './embed-wrapper'
import {Tooltip} from './tooltip'
import {cn} from './utils'

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
  const highlightRange = !collapsed && id.blockRange && 'start' in id.blockRange ? id.blockRange : undefined
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
            focusBlockId={!collapsed ? id.blockRef || undefined : undefined}
            blockRange={highlightRange}
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
