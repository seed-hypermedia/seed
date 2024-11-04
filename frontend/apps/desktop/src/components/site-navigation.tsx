import {focusDraftBlock} from '@/draft-focusing'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useCreateDraft, useListDirectory} from '@/models/documents'
import {useEntity} from '@/models/entities'
import {appRouteOfId, useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocumentRoute,
  DraftRoute,
  getDocumentTitle,
  getDraftNodesOutline,
  getMetadataName,
  getNodesOutline,
  HMBlockNode,
  hmId,
  NavRoute,
  NodesOutline,
  UnpackedHypermediaId,
} from '@shm/shared'
import {SiteNavigationPlaceholder} from '@shm/shared/src/site-navigation'
import {
  FocusButton,
  getBlockNodeById,
  HMIcon,
  Popover,
  Separator,
  SizableText,
  SmallCollapsableListItem,
  SmallListGroupItem,
  SmallListItem,
  Spinner,
  useMedia,
  usePopoverState,
  View,
} from '@shm/ui'
import {Hash, Plus} from '@tamagui/lucide-icons'
import {memo, ReactNode, useState} from 'react'
import {Directory} from './directory'

export function SiteNavigation() {
  const popoverProps = usePopoverState()

  const media = useMedia()
  return media.gtSm ? (
    <SiteNavigationContent />
  ) : (
    <Popover {...popoverProps} placement="right-end">
      <Popover.Trigger asChild>
        <SiteNavigationPlaceholder />
      </Popover.Trigger>
      <Popover.Content
        enterStyle={{y: -10, opacity: 0}}
        exitStyle={{y: -10, opacity: 0}}
        animation="fast"
        elevation="$4"
      >
        <SiteNavigationContent />
      </Popover.Content>
    </Popover>
  )
}

export function SiteNavigationContent() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error('SiteNavigation only supports document routes')
  const {id} = route
  const entity = useEntity(id)

  const navigate = useNavigate()
  const document = entity.data?.document
  const isTopLevel = !id.path || id.path?.length == 0

  const documentIndent = isTopLevel ? 0 : 1
  const parentId = hmId(id.type, id.uid, {
    path: id.path?.slice(0, -1) || [],
  })
  const parentEntity = useEntity(parentId)
  const siblingDir = useListDirectory(parentId)
  const createDraft = useCreateDraft(id)
  const capability = useMyCapability(id)

  if (!entity?.data) return null
  const documentNavigation = (
    <SmallCollapsableListItem
      key={id.uid}
      indented={documentIndent}
      title={getDocumentTitle(document)}
      icon={<HMIcon id={id} metadata={document?.metadata} size={20} />}
      onPress={() => {
        navigate({
          key: 'document',
          id,
        })
      }}
      active={!id.blockRef}
    >
      <OutlineNavigation indented={documentIndent + 1} route={route} />
      <Separator marginLeft={Math.max(0, documentIndent + 1) * 22 + 12} />
      <Directory indented={documentIndent + 1} docId={id} />
      {roleCanWrite(capability?.role) && (
        <SmallListItem
          icon={Plus}
          title="Create Document"
          onPress={createDraft}
          color="$green10"
          indented={documentIndent + 1}
        />
      )}
    </SmallCollapsableListItem>
  )
  return (
    <View flex={1} paddingLeft="$4" $gtLg={{paddingLeft: 0}}>
      {isTopLevel ? (
        documentNavigation
      ) : (
        <SmallListItem
          key={parentId.id}
          title={getDocumentTitle(parentEntity.data?.document)}
          icon={
            <HMIcon
              id={id}
              metadata={parentEntity.data?.document?.metadata}
              size={20}
            />
          }
          onPress={() => {
            navigate({
              key: 'document',
              id: parentId,
            })
          }}
        />
      )}

      {siblingDir.data?.map((item) => {
        const itemId = hmId('d', item.account, {path: item.path})
        if (itemId.id === id.id) return documentNavigation
        return (
          <SmallListItem
            key={itemId.id}
            onPress={() => {
              navigate({key: 'document', id: itemId})
            }}
            title={getMetadataName(item.metadata)}
            icon={<HMIcon id={itemId} metadata={item.metadata} size={20} />}
            indented={1}
          />
        )
      })}
    </View>
  )
}

function OutlineNavigation({
  route,
  indented,
}: {
  route: NavRoute
  indented?: number
}) {
  if (route.key == 'document') {
    return <DocumentOutlineNavigation indented={indented} route={route} />
  }
  if (route.key == 'draft') {
    return <DraftOutlineNavigation indented={indented} route={route} />
  }
  return null
}

function DraftOutlineNavigation({
  route,
  indented,
}: {
  route: DraftRoute
  indented?: number
}) {
  const {id} = route
  const draft = useDraft(id)
  const outline = getDraftNodesOutline(draft?.data?.content || [])
  if (!id) return null
  return (
    <>
      <SmallListItem
        marginTop="$4"
        key={id.uid}
        title={draft.data?.metadata?.name}
        icon={<HMIcon id={id} metadata={draft.data?.metadata} size={20} />}
        onPress={() => {}}
        active={!id.blockRef}
      />
      {outline && (
        <DraftOutline
          outline={outline}
          indented={indented}
          activeBlock={id.blockRef || undefined}
          onActivateBlock={(blockId) => {
            focusDraftBlock(id.id, blockId)
          }}
          onFocusBlock={null}
        />
      )}
    </>
  )
}

function _DraftOutline({
  activeBlock,
  onActivateBlock,
  onFocusBlock,
  indented = 0,
  outline,
}: {
  activeBlock?: string
  onActivateBlock: (blockId: string) => void
  onFocusBlock: ((blockId: string) => void) | null
  indented?: number
  outline: NodesOutline
}) {
  function getOutline(outlineNodes: NodesOutline, level = 0): ReactNode[] {
    const outlineContent = outlineNodes.map((item) => {
      const childrenOutline = item.children
        ? getOutline(item.children, level + 1)
        : null
      if (item.embedId)
        return (
          <SidebarEmbedOutlineItem
            activeBlock={activeBlock}
            id={item.embedId}
            key={item.id}
            blockId={item.id}
            indented={1 + level}
            onActivateBlock={onActivateBlock}
            onFocusBlock={onFocusBlock}
          />
        )
      return (
        <SmallListGroupItem
          key={item.id}
          onPress={() => {
            onActivateBlock(item.id)
          }}
          active={item.id === activeBlock}
          activeBgColor={item.id === activeBlock ? '$brand12' : undefined}
          icon={
            <View width={16}>
              {item.icon ? (
                <item.icon color="$color9" size={16} />
              ) : (
                <Hash color="$color9" size={16} />
              )}
            </View>
          }
          title={item.title || 'Untitled Heading'}
          indented={1 + level}
          items={childrenOutline || []}
          rightHover={[
            onFocusBlock ? (
              <FocusButton
                key="focus"
                onPress={() => {
                  onFocusBlock(item.id)
                }}
              />
            ) : null,
          ]}
          defaultExpanded
        />
      )
    })
    return outlineContent
  }

  return getOutline(outline, indented)
}
const DraftOutline = memo(_DraftOutline)

function DocumentOutlineNavigation({
  route,
  indented,
}: {
  route: DocumentRoute
  indented?: number
}) {
  const {id} = route
  const entity = useEntity(id)
  const navigate = useNavigate()
  if (!entity?.data) return null

  return (
    <>
      <DocumentOutline
        nodes={entity?.data?.document?.content}
        activeBlock={id.blockRef || undefined}
        indented={indented}
        onActivateBlock={(blockId) => {
          navigate({
            key: 'document',
            id: hmId(id.type, id.uid, {blockRef: blockId, path: id.path}),
          })
        }}
        onFocusBlock={(blockId) => {
          navigate({
            key: 'document',
            isBlockFocused: true,
            id: hmId(id.type, id.uid, {blockRef: blockId, path: id.path}),
          })
        }}
      />
    </>
  )
}

function _DocumentOutline({
  activeBlock,
  nodes,
  onActivateBlock,
  onFocusBlock,
  indented = 0,
}: {
  activeBlock?: string
  nodes?: HMBlockNode[]
  onActivateBlock: (blockId: string) => void
  onFocusBlock: ((blockId: string) => void) | null
  indented?: number
}) {
  const outline = getNodesOutline(nodes || [])

  function getOutline(outline: NodesOutline, level = 0): ReactNode[] {
    const outlineContent = outline.map((item) => {
      const childrenOutline = item.children
        ? getOutline(item.children, level + 1)
        : null
      if (item.embedId)
        return (
          <SidebarEmbedOutlineItem
            activeBlock={activeBlock}
            id={item.embedId}
            key={item.id}
            blockId={item.id}
            indented={level}
            onActivateBlock={onActivateBlock}
            onFocusBlock={onFocusBlock}
          />
        )
      return (
        <SmallListGroupItem
          key={item.id}
          onPress={() => {
            onActivateBlock(item.id)
          }}
          active={item.id === activeBlock}
          activeBgColor={item.id === activeBlock ? '$brand12' : undefined}
          icon={
            <View width={16}>
              {item.icon ? (
                <item.icon color="$color9" size={16} />
              ) : (
                <Hash color="$color9" size={16} />
              )}
            </View>
          }
          title={item.title || 'Untitled Heading'}
          indented={level}
          items={childrenOutline || []}
          rightHover={[
            onFocusBlock ? (
              <FocusButton
                key="focus"
                onPress={() => {
                  onFocusBlock(item.id)
                }}
              />
            ) : null,
          ]}
          defaultExpanded
        />
      )
    })
    return outlineContent
  }

  return getOutline(outline, indented)
}
const DocumentOutline = memo(_DocumentOutline)

const SidebarEmbedOutlineItem = memo(_EmbedOutlineItem)
function _EmbedOutlineItem({
  indented,
  id,
  blockId,
  activeBlock,
  onActivateBlock,
  onFocusBlock,
}: {
  indented: number
  id: UnpackedHypermediaId
  blockId: string
  activeBlock?: string
  onActivateBlock: (blockId: string) => void
  onFocusBlock: ((blockId: string) => void) | null
}) {
  const route = useNavRoute()
  const [collapse, setCollapse] = useState(true)
  const loadedEntity = useEntity(id)
  const navigate = useNavigate()
  const doc = loadedEntity?.data?.document
  const singleBlockNode =
    id.blockRef && doc?.content
      ? getBlockNodeById(doc.content, id.blockRef)
      : null
  const title = singleBlockNode
    ? singleBlockNode.block.text
    : getDocumentTitle(doc)
  const childrenNodes = singleBlockNode
    ? singleBlockNode.children
    : doc?.content
  const outlineNodes = childrenNodes?.filter(
    (node) => node.block?.type === 'Heading' || node.block?.type === 'Embed',
  )
  const canCollapse = !!outlineNodes?.length
  const destRoute = appRouteOfId(id)
  if (loadedEntity === undefined)
    return <SmallListItem indented={indented} icon={() => <Spinner />} />
  if (doc)
    return (
      <>
        <SmallListItem
          indented={indented}
          title={title}
          icon={<HMIcon id={id} metadata={doc.metadata} size={20} />}
          isCollapsed={canCollapse ? collapse : undefined}
          onSetCollapsed={canCollapse ? setCollapse : undefined}
          active={activeBlock === blockId}
          activeBgColor="$brand12"
          onPress={() => {
            onActivateBlock(blockId)
          }}
          rightHover={[
            destRoute ? (
              <FocusButton
                key="focus"
                onPress={() => {
                  if (!destRoute) return
                  if (destRoute.key === 'document') {
                    navigate({
                      ...destRoute,
                      id: {
                        ...destRoute.id,
                        blockRef: blockId,
                      },
                      isBlockFocused: true,
                    })
                  } else navigate(destRoute)
                }}
              />
            ) : null,
          ]}
        />
        {collapse ? null : (
          <DocumentOutline
            activeBlock={activeBlock}
            onActivateBlock={onActivateBlock}
            onFocusBlock={
              destRoute
                ? (childBlockId) => {
                    if (!destRoute) return
                    if (destRoute.key === 'document') {
                      navigate({
                        ...destRoute,
                        id: {
                          ...destRoute.id,
                          blockRef: childBlockId,
                        },
                        isBlockFocused: true,
                      })
                    } else navigate(destRoute)
                  }
                : null
            }
            nodes={outlineNodes}
            indented={indented + 1}
          />
        )}
      </>
    )
  return (
    <SizableText margin="$2" size="$1" theme="red">
      Failed to Load Embed
    </SizableText>
  )
}
