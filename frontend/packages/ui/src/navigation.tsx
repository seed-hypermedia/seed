import {
  getMetadataName,
  getNodesOutline,
  HMDocument,
  HMDocumentInfo,
  HMListedDraft,
  HMMetadata,
  HMResourceFetchResult,
  HMResourceVisibility,
  NavRoute,
  NodeOutline,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {ReactNode, useMemo} from 'react'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './/hover-card'
import {ButtonProps} from './button'
import {useHighlighter} from './highlight-context'
import {HMIcon} from './hm-icon'
import {SmallCollapsableListItem, SmallListItem} from './list-item'
import {PrivateBadge} from './private-badge'
import {useMedia} from './use-media'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

export function DocumentSmallListItem({
  metadata,
  id,
  indented,
  items,
  active,
  onClick,
  draftId,
  isPublished,
  visibility,
}: {
  metadata?: HMMetadata
  id?: UnpackedHypermediaId
  indented?: number
  items?: null | ReactNode
  active?: boolean
  onClick?: ButtonProps['onClick']
  draftId?: string | null | undefined
  isPublished?: boolean
  visibility?: HMResourceVisibility
}) {
  const route: NavRoute | undefined = draftId
    ? {key: 'draft', id: draftId, accessory: {key: 'options'}}
    : id && {key: 'document', id}
  if (!route) {
    throw new Error(
      'No route for DocumentSmallListItem. Must provide either id or draftId',
    )
  }
  const linkProps = useRouteLink(route, {onClick: onClick})
  const color = isPublished === false ? '$color11' : undefined
  const highlight = useHighlighter()
  const isPrivate = visibility === 'PRIVATE'
  const icon = id ? (
    <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} />
  ) : null

  const privateBadge = isPrivate ? <PrivateBadge size="sm" /> : null

  if (items)
    return (
      <SmallCollapsableListItem
        bold
        color={color}
        key={draftId || id?.id}
        title={getMetadataName(metadata)}
        icon={icon}
        indented={indented}
        active={active}
        {...linkProps}
        onClick={(e) => {
          // @ts-expect-error
          onClick?.()
          linkProps.onClick?.(e)
        }}
        isDraft={!!draftId}
        accessory={privateBadge}
      >
        {items}
      </SmallCollapsableListItem>
    )
  return (
    <SmallListItem
      multiline
      bold
      color={color}
      key={draftId || id?.id}
      title={getMetadataName(metadata)}
      {...highlight(id)}
      icon={icon}
      indented={indented}
      active={active}
      isDraft={!!draftId}
      accessory={privateBadge}
      {...linkProps}
    />
  )
}

export type DocNavigationItem = {
  key: string
  metadata: HMMetadata
  isPublished?: boolean
  id?: UnpackedHypermediaId
  webUrl?: string
  draftId?: string | null | undefined
  sortTime?: Date
  visibility?: HMResourceVisibility
}

export function getSiteNavDirectory({
  id,
  directory,
  drafts,
}: {
  id: UnpackedHypermediaId
  directory?: HMDocumentInfo[]
  drafts?: HMListedDraft[]
}): DocNavigationItem[] {
  const draftsArray = Array.isArray(drafts) ? drafts : []
  const editIds = new Set<string>(
    draftsArray
      // @ts-expect-error
      .map((d) => d.editId)
      .filter((id) => !!id)
      .map((id) => id.id),
  )
  const unpublishedDraftItems: DocNavigationItem[] = draftsArray
    // @ts-expect-error
    .filter((draft) => draft.locationId && draft.locationId.id === id.id)
    .map(
      (draft) =>
        ({
          key: draft.id,
          id: undefined,
          draftId: draft.id,
          metadata: draft.metadata,
          sortTime: new Date(draft.lastUpdateTime),
          isPublished: false,
        }) satisfies DocNavigationItem,
    )
  const publishedItems: DocNavigationItem[] =
    directory?.map((item) => {
      const id = item.id
      const sortTime = item.sortTime
      return {
        key: id.id,
        id,
        metadata: item.metadata,
        sortTime,
        draftId: editIds.has(id.id)
          ? // @ts-expect-error
            draftsArray.find((d) => d.editId?.id === id.id)?.id
          : undefined,
        isPublished: true,
        visibility: item.visibility,
      }
    }) ?? []
  unpublishedDraftItems
    .sort((a, b) => (b.sortTime?.getTime() || 0) - (a.sortTime?.getTime() || 0))
    .reverse()
  publishedItems
    .sort((a, b) => (b.sortTime?.getTime() || 0) - (a.sortTime?.getTime() || 0))
    .reverse()
  const directoryItems: DocNavigationItem[] = [
    ...publishedItems,
    ...unpublishedDraftItems,
  ]
  return directoryItems
}

export function useNodesOutline(
  document: HMDocument | null | undefined,
  id: UnpackedHypermediaId,
  embeddedDocs?: HMResourceFetchResult[],
) {
  return useMemo(
    () => getNodesOutline(document?.content || [], id, embeddedDocs),
    [document?.content, id, embeddedDocs],
  )
}

export function DocumentOutline({
  outline,
  indented,
  onActivateBlock,
  onClick,
  id,
  activeBlockId,
  onCloseNav,
}: {
  outline: NodeOutline[]
  indented?: number
  onActivateBlock: (blockId: string) => void
  onClick?: ButtonProps['onClick']
  id: UnpackedHypermediaId
  activeBlockId: string | null
  onCloseNav?: () => void
}) {
  return outline.map((node) => {
    const outlineProps = useRouteLink(
      {
        key: 'document',
        id: {
          ...id,
          blockRef: node.id,
          blockRange: null,
        },
      },
      {
        replace: true,
      },
    )
    return (
      <OutlineNode
        node={node}
        key={node.id}
        indented={indented}
        onActivateBlock={onActivateBlock}
        onClick={onClick}
        activeBlockId={activeBlockId}
        onCloseNav={onCloseNav}
        outlineProps={outlineProps}
        docId={id}
      />
    )
  })
}

export function DraftOutline({
  id,
  onActivateBlock,
  indented,
  onClick,
  outline = [],
}: {
  id?: UnpackedHypermediaId
  onActivateBlock: (blockId: string) => void
  indented?: number
  onClick?: ButtonProps['onClick']
  outline: NodeOutline[]
}) {
  return outline.map((node) => (
    <OutlineNode
      node={node}
      key={node.id}
      indented={indented}
      onActivateBlock={onActivateBlock}
      onClick={onClick}
      activeBlockId={null}
      docId={id}
    />
  ))
}

function OutlineNode({
  node,
  indented = 0,
  activeBlockId,
  onActivateBlock,
  onClick,
  onCloseNav,
  outlineProps,
  docId,
}: {
  node: NodeOutline
  indented?: number
  activeBlockId: string | null
  onActivateBlock: (blockId: string) => void
  onClick?: ButtonProps['onClick']
  onCloseNav?: () => void
  outlineProps?: any
  docId?: UnpackedHypermediaId
}) {
  return (
    <>
      <SmallListItem
        {...outlineProps}
        key={node.id}
        multiline
        active={node.id === activeBlockId}
        title={node.title}
        indented={indented}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault()
          if (outlineProps && outlineProps.onClick) {
            outlineProps.onClick(e)
          }
          onClick?.(e)
          onCloseNav?.()
          onActivateBlock(node.id)
        }}
      />
      {node.children?.length
        ? node.children.map((child) => {
            let childOutlineProps
            if (outlineProps && docId) {
              childOutlineProps = useRouteLink(
                {
                  key: 'document',
                  id: {
                    ...docId,
                    blockRef: child.id,
                    blockRange: null,
                  },
                },
                {
                  replace: true,
                },
              )
            }

            return (
              <OutlineNode
                node={child}
                key={child.id}
                indented={indented + 1}
                activeBlockId={activeBlockId}
                onActivateBlock={onActivateBlock}
                onClick={onClick}
                onCloseNav={onCloseNav}
                outlineProps={childOutlineProps}
                docId={docId}
              />
            )
          })
        : null}
    </>
  )
}

export function DocNavigationWrapper({
  children,
  showCollapsed,
  outline,
}: {
  children: ReactNode
  showCollapsed: boolean
  outline: Array<NodeOutline>
}) {
  const popoverState = usePopoverState()
  const media = useMedia()
  useIsomorphicLayoutEffect(() => {
    if (media.gtSm && popoverState.open) {
      popoverState.onOpenChange(false)
    }
  }, [media.gtSm])

  return showCollapsed ? (
    <div className="flex items-center justify-center">
      <HoverCard openDelay={100}>
        <HoverCardTrigger className="flex w-5 flex-col gap-3">
          {outline?.length
            ? outline.map((node) => (
                <CollapsedOutlineNode key={node.id} node={node} />
              ))
            : null}
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={12}
          className="p-1"
        >
          <div className="h-full max-h-[80vh] w-full overflow-auto">
            {children}
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  ) : (
    <div
      className="hide-scrollbar h-full overflow-auto"
      // paddingVertical="$4"
    >
      {children}
    </div>
  )
}

function CollapsedOutlineNode({
  node,
  level = 1,
}: {
  node: NodeOutline
  level?: number
}) {
  const nodes =
    !node.children?.length || node.children.length < 2
      ? undefined
      : node.children.length < 8
      ? node.children
      : node.children.slice(0, 8)
  return (
    <>
      <div
        key={node.id}
        className="bg-muted-foreground/40 h-0.5 w-full rounded-full"
      />
      {nodes ? (
        <div className={cn('flex flex-col gap-3', level < 3 && 'pl-[3px]')}>
          {nodes.map((child) => (
            <CollapsedOutlineNode
              key={child.id}
              node={child}
              level={level + 1}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
