import {focusDraftBlock} from '@/draft-focusing'
import {useMyAccount_deprecated} from '@/models/accounts'
import {
  useEntity,
  useRouteBreadcrumbRoutes,
  useRouteEntities,
} from '@/models/entities'
import {useFavorites} from '@/models/favorites'
import {appRouteOfId, getRouteKey, useNavRoute} from '@/utils/navigation'
import {DocumentRoute, NavRoute} from '@/utils/routes'
import {useNavigate} from '@/utils/useNavigate'
import {
  HMBlockNode,
  HMEntityContent,
  UnpackedHypermediaId,
  getBlockNodeById,
  getDocumentTitle,
  getProfileName,
  hmId,
  unpackHmId,
} from '@shm/shared'
import {Tooltip} from '@shm/ui'
import {
  Contact,
  FilePen,
  FileText,
  Hash,
  Pencil,
  Star,
} from '@tamagui/lucide-icons'
import {ReactNode, memo, useCallback, useMemo, useState} from 'react'
import {Button, SizableText, Spinner, View} from 'tamagui'
import {
  FocusButton,
  SidebarDivider,
  SidebarGroupItem,
  SidebarItem,
} from './sidebar-base'

type IconDefinition = React.FC<{size: any; color: any}>

export const SidebarNeo = memo(_SidebarNeo)
function _SidebarNeo() {
  const route = useNavRoute()
  const [collapseFavorites, setCollapseFavorites] = useState(true)
  const [collapseStandalone, setCollapseStandalone] = useState(false)
  const myAccount = useMyAccount_deprecated()
  const myAccountRoute: DocumentRoute | null = useMemo(() => {
    return myAccount
      ? ({key: 'document', id: hmId('a', myAccount)} as DocumentRoute)
      : null
  }, [myAccount])
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  let myAccountSection: ReactNode = null
  let standaloneSection: ReactNode = null
  const entityRoutes = useRouteBreadcrumbRoutes(route)
  const firstEntityRoute = entityRoutes[0]
  const isMyAccountDraftActive = route.key === 'draft' && route.id === myAccount
  const accountEntities = useRouteEntities(
    myAccountRoute ? [myAccountRoute] : [],
  )
  const isMyAccountActive =
    isMyAccountDraftActive ||
    (firstEntityRoute &&
      firstEntityRoute.key === 'document' &&
      firstEntityRoute.id.type === 'a' &&
      firstEntityRoute.id.eid === myAccount)
  // const [collapseMe, setCollapseMe] = useState(!isMyAccountActive)
  // const entityContents = useRouteEntities(
  //   myAccountRoute ? [myAccountRoute, ...entityRoutes] : entityRoutes,
  // )
  const handleNavigate = useCallback(function handleNavigate(
    route: NavRoute,
    doReplace?: boolean,
  ) {
    if (doReplace) replace(route)
    else navigate(route)
    // const firstEntityRoute = destEntityRoutes[0]
    // const isMyAccountActive =
    //   firstEntityRoute &&
    //   firstEntityRoute.key === 'account' &&
    //   firstEntityRoute.accountId === myAccount
    // setCollapseFavorites(true)
    // setCollapseMe(isMyAccountActive ? false : true)
    // setCollapseStandalone(isMyAccountActive ? true : false)
  }, [])

  // if (isMyAccountActive) {
  //   // the active route is under myAccount section
  //   myAccountSection = (
  //     <RouteSection
  //       onNavigate={handleNavigate}
  //       collapse={collapseMe}
  //       setCollapse={setCollapseMe}
  //       routes={entityRoutes}
  //       activeRoute={route}
  //       entityContents={entityContents}
  //       active
  //     />
  //   )
  // } else {
  //   if (myAccountRoute) {
  //     myAccountSection = (
  //       <RouteSection
  //         onNavigate={handleNavigate}
  //         collapse={collapseMe}
  //         setCollapse={setCollapseMe}
  //         routes={[myAccountRoute]}
  //         activeRoute={route}
  //         entityContents={entityContents}
  //       />
  //     )
  //   }
  //   standaloneSection = (
  //     <RouteSection
  //       onNavigate={handleNavigate}
  //       collapse={collapseStandalone}
  //       setCollapse={setCollapseStandalone}
  //       routes={entityRoutes}
  //       activeRoute={route}
  //       entityContents={entityContents}
  //       active
  //     />
  //   )
  // }
  return (
    <>
      {myAccountRoute ? (
        <>
          <SidebarDivider />
          <RouteSection
            onNavigate={handleNavigate}
            collapse={false}
            setCollapse={() => {}}
            routes={[myAccountRoute]}
            activeRoute={route}
            entityContents={accountEntities}
            active={isMyAccountActive}
          />
        </>
      ) : null}
      <SidebarDivider />
      <SidebarFavorites
        collapse={collapseFavorites}
        setCollapse={setCollapseFavorites}
        onNavigate={handleNavigate}
      />
    </>
  )
}

function getBlockHeadings(
  children: HMBlockNode[] | undefined,
  blockId: string | undefined,
) {
  let blockHeadings: null | {id: string; text: string}[] = []
  if (!blockId) return []
  function findBlock(
    nodes: HMBlockNode[] | undefined,
    parentHeadings: {id: string; text: string}[],
  ): null | HMBlockNode {
    return (
      nodes?.find((blockNode) => {
        if (!blockId) return null
        const theseHeadings = [
          ...parentHeadings,
          {
            id: blockNode.block.id,
            text: blockNode.block.text,
            embedId:
              blockNode.block.type === 'embed' ? blockNode.block.ref : null,
          },
        ]
        if (blockNode.block.id === blockId) {
          blockHeadings = theseHeadings
          return true
        }
        if (blockNode.children?.length) {
          return findBlock(blockNode.children, theseHeadings)
        }
        return false
      }) || null
    )
  }
  findBlock(children, [])
  return blockHeadings as
    | null
    | {id: string; text: string; embedId: null | string}[]
}

export function getItemDetails(
  entity: HMEntityContent | undefined,
  blockId?: string,
) {
  let name: string | undefined = undefined
  let icon: IconDefinition | undefined = undefined
  let isDraft = false
  if (!entity) return null
  console.log(`== ~ entity.id:`, entity.id)
  if (entity.id.type === 'a') {
    name = getProfileName(entity.document)
    icon = Contact
  }

  if (entity.id.type === 'draft') {
    name = '<draft>'
    icon = FilePen
    isDraft = true
  }

  if (entity.id.path?.[0] != '') {
    console.log('--- ENTITY WITH PATH', entity)
    name = getDocumentTitle(entity.document)
    icon = FileText
  }

  const headings = getBlockHeadings(entity.document?.content, blockId)
  return {
    id: entity.id,
    name,
    icon,
    headings,
    isDraft,
  }
}

type ItemDetails = ReturnType<typeof getItemDetails>

function ResumeDraftButton({info}: {info: ItemDetails}) {
  if (!info) throw new Error('ItemDetails required for ResumeDraftButton')
  const {id} = info
  const navigate = useNavigate()

  const draft = false
  if (draft) {
    return (
      <Tooltip content="Resume Editing">
        <Button
          onPress={(e: Event) => {
            e.stopPropagation()
            navigate({
              key: 'draft',
              id: draft.draftId,
            })
          }}
          size="$2"
          theme="yellow"
          icon={Pencil}
        />
      </Tooltip>
    )
  }
  return null
}

function ContextItems({
  info,
  active,
  isCollapsed,
  onSetCollapsed,
  route,
  onNavigate,
}: {
  info: ReturnType<typeof getItemDetails>
  active?: boolean
  isCollapsed?: boolean
  onSetCollapsed?: (collapse: boolean) => void
  route: DocumentRoute
  onNavigate: (route: NavRoute) => void
}) {
  if (!info) return null
  const collapsedProps = {
    isCollapsed,
    onSetCollapsed,
  }
  return (
    <>
      <SidebarItem
        active={active && !info?.headings?.length}
        {...(info.headings?.length ? {} : collapsedProps)}
        title={info.title}
        icon={info.icon}
        onPress={() => {
          if (route.key === 'draft') return
          onNavigate({...route, blockId: undefined, isBlockFocused: undefined})
        }}
        iconAfter={
          info.isDraft ? (
            <SizableText size="$1" color="$color9">
              Draft
            </SizableText>
          ) : (
            <ResumeDraftButton info={info} />
          )
        }
      />
      {info.headings?.map((heading, headingIndex) => {
        const isLast =
          !!info.headings && headingIndex === info.headings.length - 1
        if (heading.embedId) return null
        return (
          <SidebarItem
            key={heading.id}
            icon={Hash}
            active={
              active &&
              !!info.headings &&
              headingIndex === info.headings.length - 1
            }
            {...(isLast ? collapsedProps : {})}
            title={heading.text}
            onPress={() => {
              if (route.key === 'draft') return
              onNavigate({...route, blockId: heading.id, isBlockFocused: true})
            }}
          />
        )
      })}
    </>
  )
}

function RouteSection({
  routes,
  activeRoute,
  collapse,
  setCollapse,
  onNavigate,
  entityContents,
  active,
}: {
  routes: DocumentRoute[]
  activeRoute: NavRoute
  collapse?: boolean
  setCollapse?: (collapse: boolean) => void
  onNavigate: (route: NavRoute, doReplace?: boolean) => void
  entityContents?: {route: DocumentRoute; entity?: HMEntityContent}[]
  active?: boolean
}) {
  const thisRoute = routes.at(-1)
  const prevRoutes = routes.slice(0, -1)
  const thisRouteEntity = entityContents?.find((c) => c.route === thisRoute)
  const thisRouteBlockId =
    thisRoute?.key === 'draft' ? undefined : thisRoute?.blockId
  const thisRouteFocusBlockId =
    thisRoute?.key === 'draft'
      ? undefined
      : thisRoute?.isBlockFocused
      ? thisRoute?.blockId
      : undefined
  const thisRouteDetails = getItemDetails(thisRouteEntity?.entity)
  const focusedNodes =
    thisRouteFocusBlockId && thisRouteEntity?.entity?.document?.content
      ? getBlockNodeById(
          thisRouteEntity?.entity?.document?.content,
          thisRouteFocusBlockId,
        )?.children
      : thisRouteEntity?.entity?.document?.content
  const outlineNodes = focusedNodes?.filter(
    (node) => node.block.type === 'heading' || node.block.type === 'embed',
  )
  const canCollapse = !!outlineNodes?.length
  const onActivateBlock = useCallback(
    (blockId: string) => {
      throw new Error('implementation disabled.') // check use of activeRoute, should we call it that? what is it?
      if (!thisRoute) return
      const thisRouteKey = getRouteKey(thisRoute)
      const activeRouteKey = getRouteKey(activeRoute)
      const shouldReplace = thisRouteKey === activeRouteKey
      if (thisRoute.key === 'draft') {
        if (!thisRoute.draftId) return // the draft route should have an id!
        focusDraftBlock(thisRoute.draftId, blockId)
        return
      }
      onNavigate({...thisRoute, blockId, isBlockFocused: false}, shouldReplace)
    },
    [thisRoute, activeRoute],
  )
  const onFocusBlock = useMemo(() => {
    if (!thisRoute) return null
    if (thisRoute.key === 'draft') {
      return null
    }
    return (blockId: string) => {
      onNavigate({...thisRoute, blockId, isBlockFocused: true})
    }
  }, [onNavigate, thisRoute])
  return (
    <>
      {prevRoutes.map((contextRoute, index) => {
        if (contextRoute.key === 'draft') return null // draft should not appear in context
        const info: ItemDetails = getItemDetails(
          entityContents?.find((c) => c.route === contextRoute)?.entity,
        )
        return (
          <ContextItems
            key={index}
            info={info}
            route={contextRoute}
            onNavigate={onNavigate}
          />
        )
      })}
      {thisRoute && (
        <ContextItems
          info={thisRouteDetails}
          route={thisRoute}
          onNavigate={onNavigate}
          active={active}
          isCollapsed={canCollapse ? collapse : undefined}
          onSetCollapsed={setCollapse}
        />
      )}
      {collapse || !thisRoute ? null : (
        <SidebarOutline
          indent={1}
          activeBlock={thisRouteBlockId}
          nodes={outlineNodes}
          onActivateBlock={onActivateBlock}
          onFocusBlock={onFocusBlock}
        />
      )}
    </>
  )
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
  const doc = loadedEntity?.document
  const singleBlockNode =
    id.blockRef && doc?.content
      ? getBlockNodeById(doc.content, id.blockRef)
      : null
  const info = loadedEntity ? getItemDetails(loadedEntity) : null
  const title = singleBlockNode
    ? singleBlockNode.block.text
    : info?.title || 'Untitled Embed'
  const childrenNodes = singleBlockNode
    ? singleBlockNode.children
    : doc?.content
  const outlineNodes = childrenNodes?.filter(
    (node) => node.block.type === 'heading' || node.block.type === 'embed',
  )
  const canCollapse = !!outlineNodes?.length
  const destRoute = appRouteOfId(id)
  if (doc && info)
    return (
      <>
        <SidebarItem
          indented={indent}
          title={title}
          icon={info?.icon}
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

export function getNodesOutline(
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

function SidebarFavorites({
  collapse,
  setCollapse,
  onNavigate,
}: {
  collapse: boolean
  setCollapse: (collapse: boolean) => void
  onNavigate: (route: NavRoute) => void
}) {
  const navigate = useNavigate()
  const favorites = useFavorites()
  const route = useNavRoute()
  let items: ReactNode[] = []
  if (!collapse) {
    items = favorites.map((fav) => {
      const {key, url} = fav
      if (key === 'account') {
        return (
          <FavoriteAccountItem key={url} url={url} onNavigate={onNavigate} />
        )
      }
      if (key === 'document') {
        return (
          <FavoritePublicationItem
            key={url}
            url={url}
            onNavigate={onNavigate}
          />
        )
      }
      return null
    })
  }
  return (
    <>
      <SidebarItem
        active={route.key == 'favorites'}
        onPress={() => {
          navigate({key: 'favorites'})
        }}
        title="Favorites"
        bold
        isCollapsed={collapse}
        onSetCollapsed={setCollapse}
        icon={Star}
        rightHover={
          [
            // <OptionsDropdown
            //   menuItems={[
            //     {
            //       key: 'a',
            //       icon: Pencil,
            //       label: 'Edit Favorites',
            //       onPress: () => {},
            //     },
            //   ]}
            // />,
          ]
        }
      />
      {items}
    </>
  )
}

function FavoriteAccountItem({
  url,
  onNavigate,
}: {
  url: string
  onNavigate: (route: NavRoute) => void
}) {
  const id = unpackHmId(url)
  const route = useNavRoute()
  const accountId = id?.eid
  const {data} = useEntity(id)
  if (!accountId) return null
  return (
    <SidebarItem
      active={
        route.key === 'document' &&
        route.id.type === 'a' &&
        route.id.eid === accountId
      }
      indented
      onPress={() => {
        onNavigate({key: 'document', id: hmId('a', accountId)})
      }}
      title={getProfileName(data?.document)}
    />
  )
}

function FavoritePublicationItem({
  url,
  onNavigate,
}: {
  url: string
  onNavigate: (route: NavRoute) => void
}) {
  const id = unpackHmId(url)
  const route = useNavRoute()
  const doc = useEntity(id)
  const documentId = id?.qid
  if (!documentId) return null
  return (
    <SidebarItem
      indented
      active={
        route.key === 'document' &&
        route.id.type === 'd' &&
        route.id.qid === documentId
      }
      onPress={() => {
        onNavigate({
          key: 'document',
          id,
        })
      }}
      title={getDocumentTitle(doc.data?.document)}
    />
  )
}
