import {useDeleteKey, useMyAccountIds} from '@/models/daemon'
import {useEntities, useEntity} from '@/models/entities'
import {useFavorites} from '@/models/favorites'
import {appRouteOfId, useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  getBlockNodeById,
  getDocumentTitle,
  HMBlockNode,
  hmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {Button, Tooltip} from '@shm/ui'
import {
  Contact,
  Folder,
  Hash,
  Library,
  MessageCircle,
  Plus,
  Trash,
  UserPlus2,
} from '@tamagui/lucide-icons'
import React, {memo, ReactNode, useState} from 'react'
import {SizableText, Spinner, View, XStack, YStack} from 'tamagui'
import {openAddAccountWizard} from './create-account'
import {
  FocusButton,
  GenericSidebarContainer,
  SidebarGroupItem,
  SidebarItem,
} from './sidebar-base'
import {Thumbnail} from './thumbnail'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()

  return (
    <GenericSidebarContainer>
      {/* <SidebarItem
        active={route.key == 'home'}
        onPress={() => {
          navigate({key: 'home'})
        }}
        title="Home"
        bold
        icon={Home}
      /> */}
      {/* <SidebarItem
        active={route.key == 'feed'}
        onPress={() => {
          navigate({key: 'feed'})
        }}
        title="Feed"
        bold
        icon={Home}
      /> */}
      <SidebarItem
        active={route.key == 'library'}
        onPress={() => {
          navigate({key: 'library'})
        }}
        title="Library"
        bold
        icon={Library}
        rightHover={[]}
      />
      {/* <SidebarItem
        active={route.key == 'explore'}
        onPress={() => {
          navigate({key: 'explore'})
        }}
        title="Explore Content"
        bold
        icon={Sparkles}
        rightHover={[]}
      /> */}
      <SidebarItem
        active={route.key == 'contacts'}
        onPress={() => {
          navigate({key: 'contacts'})
        }}
        icon={Contact}
        title="Contacts"
        bold
      />
      <FavoritesSection />
      <AccountsSection />
      {route.key === 'document' ? <OutlineSection id={route.id} /> : null}
    </GenericSidebarContainer>
  )
}

function SidebarSection({
  title,
  children,
  accessory,
}: {
  title: string
  children: React.ReactNode
  accessory?: React.ReactNode
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  return (
    <YStack marginTop="$4" group="section">
      <XStack paddingHorizontal="$2" ai="center" jc="space-between">
        <SizableText
          fontWeight="bold"
          fontSize="$1"
          color="$color11"
          cursor="pointer"
          hoverStyle={{
            color: '$color12',
          }}
          textTransform="capitalize"
          userSelect="none"
          onPress={() => {
            setCollapsed(!collapsed)
          }}
        >
          {title}
        </SizableText>
        <XStack opacity={0} $group-section-hover={{opacity: 1}}>
          {accessory}
        </XStack>
      </XStack>
      {collapsed ? null : children}
    </YStack>
  )
}

function FavoritesSection() {
  const favorites = useFavorites()
  const favoriteEntities = useEntities(favorites || [])
  const navigate = useNavigate()
  const route = useNavRoute()
  if (!favoriteEntities.length) return null
  return (
    <SidebarSection title="Favorites">
      {favoriteEntities?.map((favorite) => {
        if (!favorite.data) return null
        const {id, document} = favorite.data
        return (
          <SidebarItem
            key={id.id}
            title={getDocumentTitle(document)}
            icon={<Thumbnail id={id} document={document} size={20} />}
            active={route.key === 'document' && route.id.id === id.id}
            onPress={() => {
              navigate({key: 'document', id})
            }}
          />
        )
      })}
    </SidebarSection>
  )
}

function AccountsSection() {
  const accountIds = useMyAccountIds()
  const accounts = useEntities(
    accountIds.data?.map((uid) => hmId('d', uid)) || [],
  )
  const hasAccounts = !!accountIds.data?.length
  const route = useNavRoute()
  const navigate = useNavigate()
  const deleteKey = useDeleteKey()
  return (
    <SidebarSection
      title="Accounts"
      accessory={
        hasAccounts ? (
          <Tooltip content="Add Account">
            <Button
              bg="$colorTransparent"
              chromeless
              size="$1"
              icon={Plus}
              onPress={openAddAccountWizard}
            />
          </Tooltip>
        ) : undefined
      }
    >
      {accounts.map((account) => {
        if (!account.data) return null
        const {id, document} = account.data
        return (
          <SidebarItem
            key={id.uid}
            title={getDocumentTitle(document)}
            icon={<Thumbnail id={id} document={document} size={20} />}
            onPress={() => {
              navigate({key: 'document', id})
            }}
            active={
              route.key === 'document' &&
              route.id.uid === id.uid &&
              !route.id.path?.length
            }
            rightHover={[
              <Tooltip content="Delete Account Key from this device">
                <Button
                  size="$1"
                  theme="red"
                  icon={Trash}
                  onPress={
                    account.data?.id.id
                      ? () =>
                          deleteKey.mutateAsync({
                            accountId: account.data!.id.uid,
                          })
                      : undefined
                  }
                />
              </Tooltip>,
            ]}
          />
        )
      })}
      {hasAccounts ? null : (
        <SidebarItem
          key="add-account"
          title="Add Account"
          onPress={openAddAccountWizard}
          icon={UserPlus2}
        />
      )}
    </SidebarSection>
  )
}

function OutlineSection({id}: {id: UnpackedHypermediaId}) {
  const entity = useEntity(id)
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const navigate = useNavigate()
  if (route.key !== 'document') return null
  const {tab} = route
  if (!entity?.data) return null
  const {document} = entity.data
  return (
    <>
      <SidebarItem
        marginTop="$4"
        key={id.uid}
        title={getDocumentTitle(document)}
        icon={<Thumbnail id={id} document={document} size={20} />}
        onPress={() => {
          navigate({key: 'document', id: hmId(id.type, id.uid)})
        }}
        active={!id.blockRef}
      />
      <SidebarOutline
        nodes={entity?.data?.document?.content}
        activeBlock={id.blockRef || undefined}
        indent={1}
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
      <SidebarItem
        indented={1}
        icon={MessageCircle}
        active={tab === 'discussion'}
        title="Discussion"
        onPress={() => {
          replace({...route, tab: 'discussion'})
        }}
      />
      <SidebarItem
        indented={1}
        icon={Folder}
        active={tab === 'directory' || !tab}
        title="Directory"
        onPress={() => {
          replace({...route, tab: 'directory'})
        }}
      />
    </>
  )
}

function _SidebarOutline({
  activeBlock,
  nodes,
  onActivateBlock,
  onFocusBlock,
  indent = 0,
}: {
  activeBlock?: string
  nodes?: HMBlockNode[]
  onActivateBlock: (blockId: string) => void
  onFocusBlock: ((blockId: string) => void) | null
  indent?: number
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
            indent={1 + level}
            onActivateBlock={onActivateBlock}
            onFocusBlock={onFocusBlock}
          />
        )
      return (
        <SidebarGroupItem
          key={item.id}
          onPress={() => {
            onActivateBlock(item.id)
          }}
          active={item.id === activeBlock}
          activeBgColor={item.id === activeBlock ? '$yellow4' : undefined}
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

  return getOutline(outline, indent)
}
const SidebarOutline = memo(_SidebarOutline)

type IconDefinition = React.FC<{size: any; color: any}>

type NodeOutline = {
  title?: string
  id: string
  entityId?: UnpackedHypermediaId
  embedId?: UnpackedHypermediaId
  parentBlockId?: string
  children?: NodeOutline[]
  icon?: IconDefinition
}
type NodesOutline = NodeOutline[]

function getNodesOutline(
  children: HMBlockNode[],
  parentEntityId?: UnpackedHypermediaId,
  parentBlockId?: string,
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.block.type === 'heading') {
      outline.push({
        id: child.block.id,
        title: child.block.text,
        entityId: parentEntityId,
        parentBlockId,
        children:
          child.children &&
          getNodesOutline(child.children, parentEntityId, parentBlockId),
      })
    } else if (
      child.block.type === 'embed' &&
      child.block.attributes?.view !== 'card'
    ) {
      const embedId = unpackHmId(child.block.ref)
      if (embedId) {
        outline.push({
          id: child.block.id,
          embedId,
        })
      }
    } else if (child.children) {
      outline.push(
        ...getNodesOutline(child.children, parentEntityId, parentBlockId),
      )
    }
  })
  return outline
}

const SidebarEmbedOutlineItem = memo(_SidebarEmbedOutlineItem)
function _SidebarEmbedOutlineItem({
  indent,
  id,
  blockId,
  activeBlock,
  onActivateBlock,
  onFocusBlock,
}: {
  indent: number
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
  if (loadedEntity === undefined)
    return <SidebarItem indented={indent} icon={() => <Spinner />} />
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
    (node) => node.block?.type === 'heading' || node.block?.type === 'embed',
  )
  const canCollapse = !!outlineNodes?.length
  const destRoute = appRouteOfId(id)
  if (doc)
    return (
      <>
        <SidebarItem
          indented={indent}
          title={title}
          icon={<Thumbnail id={id} document={doc} size={20} />}
          isCollapsed={canCollapse ? collapse : undefined}
          onSetCollapsed={canCollapse ? setCollapse : undefined}
          active={activeBlock === blockId}
          activeBgColor={'$yellow4'}
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
          <SidebarOutline
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
            indent={indent}
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
