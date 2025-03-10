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
import {Popover} from '@tamagui/popover'
import {GestureReponderEvent, useMedia} from '@tamagui/web'
import {ReactNode, useLayoutEffect, useMemo} from 'react'
import {XStack, YStack} from 'tamagui'
import {HMIcon} from './hm-icon'
import {SmallCollapsableListItem, SmallListItem} from './list-item'
import {usePopoverState} from './use-popover-state'

export function DocumentSmallListItem({
  metadata,
  id,
  indented,
  items,
  active,
  onPress,
  isDraft,
  isPublished,
}: {
  metadata?: HMMetadata
  id: UnpackedHypermediaId
  indented?: number
  items?: null | ReactNode
  active?: boolean
  onPress?: () => void
  isDraft?: boolean
  isPublished?: boolean
}) {
  const route: NavRoute = isDraft ? {key: 'draft', id} : {key: 'document', id}
  const linkProps = useRouteLink(route)
  const color = isPublished === false ? '$color11' : undefined
  const backgroundColor = isDraft ? '$yellow3' : undefined
  const hoverBackgroundColor = isDraft ? '$yellow4' : '$color4'
  if (items)
    return (
      <SmallCollapsableListItem
        bold
        color={color}
        backgroundColor={backgroundColor}
        hoverStyle={{backgroundColor: hoverBackgroundColor}}
        key={id.id}
        title={getMetadataName(metadata)}
        icon={<HMIcon id={id} metadata={metadata} size={20} />}
        indented={indented}
        active={active}
        {...linkProps}
        onPress={(e) => {
          onPress?.()
          linkProps.onPress?.(e)
        }}
      >
        {items}
      </SmallCollapsableListItem>
    )
  return (
    <SmallListItem
      multiline
      bold
      color={color}
      backgroundColor={backgroundColor}
      hoverStyle={{backgroundColor: hoverBackgroundColor}}
      key={id.id}
      title={getMetadataName(metadata)}
      icon={<HMIcon id={id} metadata={metadata} size={20} />}
      indented={indented}
      active={active}
      {...linkProps}
    />
  )
}

export type SiteNavigationDocument = {
  metadata: HMMetadata
  isDraft: boolean
  isPublished: boolean
  sortTime: Date
  id: UnpackedHypermediaId
}

export function getSiteNavDirectory({
  id,
  supportQueries,
  drafts,
  what,
}: {
  id: UnpackedHypermediaId
  supportQueries?: HMQueryResult[]
  drafts?: HMListedDraft[]
  what?: boolean
}): SiteNavigationDocument[] {
  const directory = supportQueries?.find(
    (query) =>
      query.in.uid === id.uid &&
      (query.in.path || []).join('/') === (id.path || []).join('/'),
  )
  const directoryDrafts = drafts?.filter(
    (draft) =>
      !!draft.id.path &&
      draft.id.path.join('/').startsWith(id.path ? id.path.join('/') : '') &&
      draft.id.path.length === (id.path?.length || 0) + 1,
  )
  const idPath = id.path || []
  const publishedIds = new Set(
    directory?.results.map(
      (doc) => hmId('d', doc.account, {path: doc.path}).id,
    ),
  )
  const draftIds = new Set(directoryDrafts?.map((draft) => draft.id.id))
  const unpublishedDraftItems: SiteNavigationDocument[] =
    directoryDrafts
      ?.filter((draft) => !publishedIds.has(draft.id.id))
      .map((draft) => ({
        id: draft.id,
        metadata: draft.metadata,
        sortTime: new Date(draft.lastUpdateTime),
        isDraft: true,
        isPublished: false,
      })) || []
  const publishedItems: SiteNavigationDocument[] =
    directory?.results
      ?.filter((doc) => {
        return (
          (doc.path || []).join('/').startsWith(idPath.join('/')) &&
          idPath.length === (doc.path || []).length - 1
        )
      })
      ?.map((item) => {
        const id = hmId('d', item.account, {path: item.path})
        const sortTime = normalizeDate(item.createTime)
        if (!sortTime) return null
        return {
          id,
          metadata: item.metadata,
          sortTime,
          isDraft: draftIds.has(id.id),
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
  const directoryItems: SiteNavigationDocument[] = [
    ...publishedItems,
    ...unpublishedDraftItems,
  ]
  return directoryItems
}

// export function SiteNavigationContent({
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
              key={doc.id.path?.join('/') || doc.id.id}
              metadata={doc.metadata}
              id={doc.id}
              onPress={onPress}
              indented={0}
              isDraft={doc.isDraft}
              isPublished={doc.isPublished}
            />
          ))
        : null}
      {createDirItem?.({indented: 0})}
    </YStack>
  )
}

export function DocumentOutline({
  document,
  indented,
  onActivateBlock,
  onPress,
  id,
  supportDocuments,
  activeBlockId,
  onCloseNav,
}: {
  document: HMDocument
  indented?: number
  onActivateBlock: (blockId: string) => void
  onPress?: () => void
  id: UnpackedHypermediaId
  supportDocuments?: HMEntityContent[]
  activeBlockId: string | null
  onCloseNav?: () => void
}) {
  const outline = useMemo(() => {
    return getNodesOutline(document.content, id, supportDocuments)
  }, [id, document.content, supportDocuments])
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
      undefined,
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
          if (outlineProps.onPress) {
            outlineProps.onPress(e)
          }
          onPress?.()
          onCloseNav?.()
          onActivateBlock(node.id)
        }}
      />
      {node.children?.length
        ? node.children.map((child) => {
            const childOutlineProps = useRouteLink(
              {
                key: 'document',
                id: {
                  ...docId,
                  blockRef: child.id,
                  blockRange: null,
                },
              },
              undefined,
              {
                replace: true,
              },
            )
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

export function SiteNavigationWrapper({children}: {children: ReactNode}) {
  const popoverState = usePopoverState()
  const media = useMedia()
  useLayoutEffect(() => {
    if (media.gtSm && popoverState.open) {
      popoverState.onOpenChange(false)
    }
  }, [media.gtSm])

  return (
    <>
      <YStack $gtSm={{display: 'none'}}>
        <Popover placement="right" {...popoverState}>
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
          >
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
            <XStack bg="$color8" h={2} w="90%" borderRadius="$8" />
          </Popover.Trigger>
          <Popover.Content
            y={50}
            enterStyle={{x: -10, y: 50, opacity: 0}}
            exitStyle={{x: -10, y: 50, opacity: 0}}
            animation="fast"
            elevation="$4"
          >
            <YStack height="100%" maxHeight="80vh" overflow="scroll">
              {children}
            </YStack>
          </Popover.Content>
        </Popover>
      </YStack>
      <YStack
        className="hide-scrollbar"
        display="none"
        $gtSm={{display: 'flex'}}
        overflow="scroll"
        height="100%"
        // paddingVertical="$4"
      >
        {children}
      </YStack>
    </>
  )
}
