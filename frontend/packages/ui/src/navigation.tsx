import {
  getDraftNodesOutline,
  getMetadataName,
  getNodesOutline,
  HMDocument,
  HMDraft,
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
import {GestureReponderEvent, useMedia} from '@tamagui/web'
import {ReactNode, useLayoutEffect, useMemo} from 'react'
import {XStack, YStack} from 'tamagui'
import {HMIcon} from './hm-icon'
import {SmallCollapsableListItem, SmallListItem} from './list-item'
import {Popover} from './TamaguiPopover'
import {usePopoverState} from './use-popover-state'

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
    : id && {key: 'document', id, accessory: {key: 'options'}}
  if (!route) {
    throw new Error(
      'No route for DocumentSmallListItem. Must provide either id or draftId',
    )
  }
  const linkProps = useRouteLink(route)
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

export type DocNavigationDocument = {
  metadata: HMMetadata
  isPublished: boolean
  sortTime: Date
  id?: UnpackedHypermediaId
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
}): DocNavigationDocument[] {
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
  const unpublishedDraftItems: DocNavigationDocument[] =
    drafts
      ?.filter((draft) => draft.locationId && draft.locationId.id === id.id)
      .map(
        (draft) =>
          ({
            id: undefined,
            draftId: draft.id,
            metadata: draft.metadata,
            sortTime: new Date(draft.lastUpdateTime),
            isPublished: false,
          }) satisfies DocNavigationDocument,
      ) || []
  const publishedItems: DocNavigationDocument[] =
    directory?.results
      ?.filter((doc) => {
        return (
          (doc.path || []).join('/').startsWith(idPath.join('/')) &&
          idPath.length === (doc.path || []).length - 1
        )
      })
      ?.map((item) => {
        const id = hmId('d', item.account, {path: item.path, latest: true})
        const sortTime = normalizeDate(item.createTime)
        if (!sortTime) return null
        return {
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
  const directoryItems: DocNavigationDocument[] = [
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
    <YStack gap="$2.5">
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
    </YStack>
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
  draft,
  id,
  supportDocuments,
  onActivateBlock,
  indented,
  onPress,
}: {
  draft: HMDraft
  id: UnpackedHypermediaId
  supportDocuments: HMEntityContent[]
  onActivateBlock: (blockId: string) => void
  indented?: number
  onPress?: () => void
}) {
  const outline = useMemo(() => {
    return getDraftNodesOutline(draft.content, id, supportDocuments)
  }, [id, draft.content, supportDocuments])
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
        onPress={(e: GestureReponderEvent) => {
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
}: {
  children: ReactNode
  showCollapsed: boolean
}) {
  const popoverState = usePopoverState()
  const media = useMedia()
  useLayoutEffect(() => {
    if (media.gtSm && popoverState.open) {
      popoverState.onOpenChange(false)
    }
  }, [media.gtSm])

  return showCollapsed ? (
    <YStack jc="center" ai="center">
      <Popover placement="right" {...popoverState} hoverable>
        <Popover.Trigger
          opacity={popoverState.open ? 0 : 1}
          bg="$color6"
          x={0}
          paddingVertical="$3"
          paddingHorizontal={3}
          borderRadius={100}
          gap="$3"
          jc="space-between"
          w="100%"
          enterStyle={{opacity: 0}}
          exitStyle={{opacity: 0}}
          animation="fast"
          maxWidth={12}
        >
          <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
          <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
          <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
          <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
          <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
        </Popover.Trigger>
        <Popover.Content
          minWidth={280}
          maxWidth={600}
          y={50}
          enterStyle={{x: -10, y: 50, opacity: 0}}
          exitStyle={{x: -10, y: 50, opacity: 0}}
          animation="fast"
          elevation="$4"
        >
          <YStack height="100%" w="100%" maxHeight="80vh" overflow="scroll">
            {children}
          </YStack>
        </Popover.Content>
      </Popover>
    </YStack>
  ) : (
    <YStack
      className="hide-scrollbar"
      overflow="scroll"
      height="100%"
      // paddingVertical="$4"
    >
      {children}
    </YStack>
  )
}
