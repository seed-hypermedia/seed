import {
  getMetadataName,
  getNodesOutline,
  HMDocument,
  HMEntityContent,
  hmId,
  HMListedDraft,
  HMMetadata,
  HMQueryResult,
  NavRoute,
  NodeOutline,
  normalizeDate,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {ReactNode, useLayoutEffect, useMemo} from 'react'
import {GestureResponderEvent} from 'react-native'
import {HoverCard, HoverCardContent, HoverCardTrigger} from './/hover-card'
import {HMIcon} from './hm-icon'
import {SmallCollapsableListItem, SmallListItem} from './list-item'
import {useMedia} from './use-media'
import {usePopoverState} from './use-popover-state'
import {cn} from './utils'

export function DocumentSmallListItem({
  metadata,
  id,
  indented,
  items,
  active,
  onPress,
  draftId,
  isPublished,
}: {
  metadata?: HMMetadata
  id?: UnpackedHypermediaId
  indented?: number
  items?: null | ReactNode
  active?: boolean
  onPress?: () => void
  draftId?: string | null | undefined
  isPublished?: boolean
}) {
  const route: NavRoute | undefined = draftId
    ? {key: 'draft', id: draftId, accessory: {key: 'options'}}
    : id && {key: 'document', id}
  if (!route) {
    throw new Error(
      'No route for DocumentSmallListItem. Must provide either id or draftId',
    )
  }
  const linkProps = useRouteLink(route, {onPress})
  const color = isPublished === false ? '$color11' : undefined

  if (items)
    return (
      <SmallCollapsableListItem
        bold
        color={color}
        hoverStyle={{backgroundColor: '$backgroundHover'}}
        key={draftId || id?.id}
        title={getMetadataName(metadata)}
        icon={id && <HMIcon id={id} metadata={metadata} size={20} />}
        indented={indented}
        active={active}
        {...linkProps}
        onPress={(e) => {
          onPress?.()
          linkProps.onPress?.(e)
        }}
        isDraft={!!draftId}
      >
        {items}
        {/* {draftId ? <DraftBadge /> : null} */}
      </SmallCollapsableListItem>
    )
  return (
    <SmallListItem
      multiline
      bold
      color={color}
      hoverStyle={{backgroundColor: '$backgroundHover'}}
      key={draftId || id?.id}
      title={getMetadataName(metadata)}
      icon={id && <HMIcon id={id} metadata={metadata} size={20} />}
      indented={indented}
      active={active}
      isDraft={!!draftId}
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
}

export function getSiteNavDirectory({
  id,
  supportQueries,
  drafts,
}: {
  id: UnpackedHypermediaId
  supportQueries?: HMQueryResult[]
  drafts?: HMListedDraft[]
}): DocNavigationItem[] {
  const directory = supportQueries?.find(
    (query) =>
      query.in.uid === id.uid &&
      (query.in.path || []).join('/') === (id.path || []).join('/'),
  )
  const idPath = id.path || []
  const editIds = new Set<string>(
    drafts
      ?.map((d) => d.editId)
      .filter((id) => !!id)
      .map((id) => id.id) || [],
  )
  const unpublishedDraftItems: DocNavigationItem[] =
    drafts
      ?.filter((draft) => draft.locationId && draft.locationId.id === id.id)
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
      ) || []
  const publishedItems: DocNavigationItem[] =
    directory?.results
      ?.filter((doc) => {
        return (
          (doc.path || []).join('/').startsWith(idPath.join('/')) &&
          idPath.length === (doc.path || []).length - 1
        )
      })
      ?.map((item) => {
        const id = hmId(item.account, {path: item.path, latest: true})
        const sortTime = normalizeDate(item.createTime)
        if (!sortTime) return null
        return {
          key: id.id,
          id,
          metadata: item.metadata,
          sortTime,
          // isDraft: editIds.has(id.id),
          draftId: editIds.has(id.id)
            ? drafts?.find((d) => d.editId?.id === id.id)?.id
            : undefined,
          isPublished: true,
        }
      })
      ?.filter((item) => !!item) || []
  unpublishedDraftItems
    .sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime())
    .reverse()
  publishedItems
    .sort((a, b) => b.sortTime.getTime() - a.sortTime.getTime())
    .reverse()
  const directoryItems: DocNavigationItem[] = [
    ...publishedItems,
    ...unpublishedDraftItems,
  ]
  return directoryItems
}

// export function DocNavigationContent({
//   homeId,
//   supportQueries,
//   onPress,
// }: {
//   homeId: UnpackedHypermediaId;
//   supportQueries?: HMQueryResult[];
//   onPress?: () => void;
// }) {
//   const directoryItems = getSiteNavDirectory({
//     id: homeId,
//     supportQueries,
//     drafts: undefined,
//   });
//   return (
//     <YStack gap="$2.5" paddingLeft="$4" marginBottom="$4">
//       {directoryItems
//         ? directoryItems.map((doc) => (
//             <DocumentSmallListItem
//               key={doc.id.path?.join("/") || doc.id.id}
//               metadata={doc.metadata}
//               id={doc.id}
//               onPress={onPress}
//               indented={0}
//               isDraft={doc.isDraft}
//               isPublished={doc.isPublished}
//             />
//           ))
//         : null}
//     </YStack>
//   );
// }

export function DocDirectory({
  supportQueries,
  id,
  createDirItem,
  onPress,
  drafts,
}: {
  supportQueries?: HMQueryResult[]
  id: UnpackedHypermediaId
  createDirItem?: ((opts: {indented: number}) => ReactNode) | null
  onPress?: () => void
  drafts?: HMListedDraft[]
}) {
  const directoryItems = getSiteNavDirectory({id, supportQueries, drafts})
  return (
    <div className="flex flex-col gap-2.5">
      {directoryItems
        ? directoryItems.map((doc) => (
            <DocumentSmallListItem
              key={doc.draftId || doc.id?.path?.join('/') || doc.id?.id}
              metadata={doc.metadata}
              id={doc.id}
              onPress={onPress}
              indented={0}
              draftId={doc.draftId}
              isPublished={doc.isPublished}
            />
          ))
        : null}
      {createDirItem?.({indented: 0})}
    </div>
  )
}

export function useNodesOutline(
  document: HMDocument | null | undefined,
  id: UnpackedHypermediaId,
  supportDocuments?: HMEntityContent[],
) {
  return useMemo(
    () => getNodesOutline(document?.content || [], id, supportDocuments),
    [document?.content, id, supportDocuments],
  )
}

export function DocumentOutline({
  outline,
  indented,
  onActivateBlock,
  onPress,
  id,
  activeBlockId,
  onCloseNav,
}: {
  outline: NodeOutline[]
  indented?: number
  onActivateBlock: (blockId: string) => void
  onPress?: () => void
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
        onPress={onPress}
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
  onPress,
  outline = [],
}: {
  id: UnpackedHypermediaId
  onActivateBlock: (blockId: string) => void
  indented?: number
  onPress?: () => void
  outline: NodeOutline[]
}) {
  return outline.map((node) => (
    <OutlineNode
      node={node}
      key={node.id}
      indented={indented}
      onActivateBlock={onActivateBlock}
      onPress={onPress}
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
  onPress,
  onCloseNav,
  outlineProps,
  docId,
}: {
  node: NodeOutline
  indented?: number
  activeBlockId: string | null
  onActivateBlock: (blockId: string) => void
  onPress?: () => void
  onCloseNav?: () => void
  outlineProps?: any
  docId: UnpackedHypermediaId
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
        onPress={(e: GestureResponderEvent) => {
          e.preventDefault()
          if (outlineProps && outlineProps.onPress) {
            outlineProps.onPress(e)
          }
          onPress?.()
          onCloseNav?.()
          onActivateBlock(node.id)
        }}
      />
      {node.children?.length
        ? node.children.map((child) => {
            let childOutlineProps
            if (outlineProps) {
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
                onPress={onPress}
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
  useLayoutEffect(() => {
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
  return (
    <>
      <div
        key={node.id}
        className="bg-muted-foreground/40 h-0.5 w-full rounded-full"
      />
      {node.children?.length ? (
        <div className={cn('flex flex-col gap-3', level < 3 && 'pl-[3px]')}>
          {node.children.map((child) => (
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
