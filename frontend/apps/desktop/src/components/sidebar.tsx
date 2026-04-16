import {useBookmarks} from '@/models/bookmarks'
import {useComments} from '@/models/comments'
import {useContactList} from '@/models/contacts'
import {useSubscribedDocuments} from '@/models/library'
import {
  type SidebarSectionId,
  useSidebarSectionOrder,
  useSidebarSectionPrefs,
  useSetSidebarCollapsed,
  useSetSidebarSortMode,
  useSetSidebarSectionOrder,
  useSetSidebarItemOrder,
} from '@/models/ui-preferences'
import {mergeWithUserOrder} from '@/utils/merge-user-order'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements, monitorForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {attachClosestEdge, extractClosestEdge, type Edge} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import {getReorderDestinationIndex} from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index'
import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMComment,
  HMContactRecord,
  HMMetadata,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {useRouteLink} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hasProfileSubscription, useFollowProfile, useLeaveSite} from '@shm/shared/models/join-site'
import {createDocumentNavRoute} from '@shm/shared/routes'
import {bookmarkUrlFromRoute, hmId, ViewTerm, viewTermToRouteKey} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {LibraryEntryUpdateSummary} from '@shm/ui/activity'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {
  SidebarContent,
  SidebarFooter as SidebarFooterLayout,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@shm/ui/components/sidebar'
import {useImageUrl} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {CircleOff} from '@shm/ui/icons'
import {SmallListItem} from '@shm/ui/list-item'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {
  AlertCircle,
  ArrowDownAZ,
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  Folder,
  Hand,
  History,
  Library,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Quote,
  Users,
} from 'lucide-react'
import {nanoid} from 'nanoid'
import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {CreateDocumentButton} from './create-doc-button'
import {GenericSidebarContainer} from './sidebar-base'

export const AppSidebar = memo(MainAppSidebar)

function DropIndicatorLine({edge}: {edge: Edge | null}) {
  if (edge !== 'top' && edge !== 'bottom') return null
  return (
    <div
      className="bg-primary pointer-events-none absolute right-1 left-1 z-10 h-0.5 rounded-full"
      style={edge === 'top' ? {top: -1} : {bottom: -1}}
    />
  )
}

// Section component lookup for dynamic rendering
const SECTION_COMPONENTS: Record<SidebarSectionId, React.ComponentType> = {
  'joined-sites': SubscriptionsSection,
  following: FollowingSection,
  bookmarks: BookmarksSection,
  library: LibraryFooterItem,
  drafts: DraftsFooterItem,
}

const FOOTER_SECTIONS: SidebarSectionId[] = ['library', 'drafts']

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  const sectionOrder = useSidebarSectionOrder()

  // Split sections into main content vs footer
  const mainSections = sectionOrder.filter((id) => !FOOTER_SECTIONS.includes(id))
  const footerSections = sectionOrder.filter((id) => FOOTER_SECTIONS.includes(id))

  // DnD state for section reordering (monitorForElements is global — no DOM ref needed)
  const setSectionOrder = useSetSidebarSectionOrder()

  useEffect(() => {
    return monitorForElements({
      onDrop({source, location}) {
        const target = location.current.dropTargets[0]
        if (!target) return
        const sourceType = source.data.type as string
        if (sourceType !== 'sidebar-section') return
        const sourceId = source.data.sectionId as SidebarSectionId
        const targetId = target.data.sectionId as SidebarSectionId
        if (sourceId === targetId) return
        const sourceIndex = sectionOrder.indexOf(sourceId)
        const targetIndex = sectionOrder.indexOf(targetId)
        if (sourceIndex === -1 || targetIndex === -1) return
        const edge = extractClosestEdge(target.data)
        const destinationIndex = getReorderDestinationIndex({
          startIndex: sourceIndex,
          indexOfTarget: targetIndex,
          closestEdgeOfTarget: edge,
          axis: 'vertical',
        })
        const newOrder = [...sectionOrder]
        const [removed] = newOrder.splice(sourceIndex, 1)
        newOrder.splice(destinationIndex, 0, removed)
        setSectionOrder.mutate(newOrder)
      },
    })
  }, [sectionOrder, setSectionOrder])

  return (
    <GenericSidebarContainer
      footer={({isVisible}) => {
        // Check if any footer section is visible
        const visibleFooterSections = footerSections.filter((id) => {
          const Component = SECTION_COMPONENTS[id]
          return Component !== undefined
        })
        if (visibleFooterSections.length === 0) return null
        return <SidebarFooterContent footerSections={visibleFooterSections} route={route} navigate={navigate} />
      }}
    >
      <SidebarHeader>
        <CreateDocumentButton />
      </SidebarHeader>
      <SidebarContent>
        <MySiteSection selectedAccountId={selectedAccountId ?? undefined} />
        {mainSections.map((sectionId) => {
          return <VisibleSection key={sectionId} sectionId={sectionId} />
        })}
      </SidebarContent>
    </GenericSidebarContainer>
  )
}

function VisibleSection({sectionId}: {sectionId: SidebarSectionId}) {
  const prefs = useSidebarSectionPrefs(sectionId)
  if (!prefs.visible) return null
  const Component = SECTION_COMPONENTS[sectionId]
  if (!Component) return null
  return <Component />
}

function SidebarFooterContent({
  footerSections,
  route,
  navigate,
}: {
  footerSections: SidebarSectionId[]
  route: ReturnType<typeof useNavRoute>
  navigate: ReturnType<typeof useNavigate>
}) {
  const libraryPrefs = useSidebarSectionPrefs('library')
  const draftsPrefs = useSidebarSectionPrefs('drafts')

  const showLibrary = libraryPrefs.visible && footerSections.includes('library')
  const showDrafts = draftsPrefs.visible && footerSections.includes('drafts')

  if (!showLibrary && !showDrafts) return null

  return (
    <SidebarFooterLayout className="gap-0 p-0">
      <SidebarSeparator />
      <SidebarMenu className="py-4">
        {showLibrary && (
          <SidebarMenuItem>
            <SmallListItem
              active={route.key == 'library'}
              onClick={() => {
                navigate({key: 'library'})
              }}
              title="Library"
              bold
              icon={<Library className="size-4" />}
              rightHover={[]}
            />
          </SidebarMenuItem>
        )}
        {showDrafts && (
          <SidebarMenuItem>
            <SmallListItem
              active={route.key == 'drafts'}
              onClick={() => {
                navigate({key: 'drafts'})
              }}
              icon={<File className="size-4" />}
              title="Drafts"
              bold
            />
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarFooterLayout>
  )
}

// Stub components for footer items (they render in footer, not in content area)
function LibraryFooterItem() {
  return null
}
function DraftsFooterItem() {
  return null
}

const SORT_MODE_CYCLE = ['activity', 'alphabetical', 'manual'] as const
type SortMode = (typeof SORT_MODE_CYCLE)[number]

const SORT_MODE_ICONS: Record<SortMode, React.ElementType> = {
  activity: Clock,
  alphabetical: ArrowDownAZ,
  manual: Hand,
}

const SORT_MODE_LABELS: Record<SortMode, string> = {
  activity: 'Sort by activity',
  alphabetical: 'Sort alphabetically',
  manual: 'Manual order',
}

function SidebarSection({
  title,
  sectionId,
  children,
  accessory,
}: {
  title: string
  sectionId: SidebarSectionId
  children: React.ReactNode
  accessory?: React.ReactNode
}) {
  const prefs = useSidebarSectionPrefs(sectionId)
  const setCollapsed = useSetSidebarCollapsed()
  const setSortMode = useSetSidebarSortMode()

  const collapsed = prefs.collapsed
  let Icon = collapsed ? ChevronRight : ChevronDown

  // Sort mode cycling
  const currentSortMode = prefs.sortMode
  const SortIcon = SORT_MODE_ICONS[currentSortMode]
  const sortLabel = SORT_MODE_LABELS[currentSortMode]

  const handleCycleSortMode = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const currentIndex = SORT_MODE_CYCLE.indexOf(currentSortMode)
      const nextMode = SORT_MODE_CYCLE[(currentIndex + 1) % SORT_MODE_CYCLE.length]
      setSortMode.mutate({sectionId, sortMode: nextMode})
    },
    [currentSortMode, sectionId, setSortMode],
  )

  // DnD for section header reordering
  const headerRef = useRef<HTMLDivElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    if (!headerRef.current) return
    return combine(
      draggable({
        element: headerRef.current,
        getInitialData: () => ({type: 'sidebar-section', sectionId}),
      }),
      dropTargetForElements({
        element: headerRef.current,
        getData: ({input, element}) =>
          attachClosestEdge({type: 'sidebar-section', sectionId}, {input, element, allowedEdges: ['top', 'bottom']}),
        canDrop: ({source}) => source.data.type === 'sidebar-section' && source.data.sectionId !== sectionId,
        onDrag: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragEnter: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [sectionId])

  return (
    <SidebarGroup className="mt-4">
      <div ref={headerRef} className="relative flex items-center justify-between px-2">
        <DropIndicatorLine edge={closestEdge} />
        <SidebarGroupLabel
          className="group/header hover:bg-border flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 tracking-normal normal-case"
          onClick={() => {
            setCollapsed.mutate({sectionId, collapsed: !collapsed})
          }}
        >
          <SizableText
            weight="bold"
            size="xs"
            color="muted"
            className="group-hover/header:text-foreground flex-1 capitalize select-none"
          >
            {title}
          </SizableText>
          <div className="flex h-5 w-4 items-center justify-center">
            <Icon size={14} />
          </div>
        </SidebarGroupLabel>
        <div className="flex items-center gap-0.5">
          <Tooltip content={sortLabel}>
            <button
              className="hover:bg-border text-muted-foreground hover:text-foreground flex h-5 w-5 items-center justify-center rounded"
              onClick={handleCycleSortMode}
            >
              <SortIcon size={12} />
            </button>
          </Tooltip>
          {accessory ? <div className="flex">{accessory}</div> : null}
        </div>
      </div>
      {collapsed ? null : (
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

function BookmarksSection() {
  const bookmarks = useBookmarks()
  const contacts = useSelectedAccountContacts()
  const bookmarkIds = bookmarks.map((b) => b.id)
  const bookmarkEntities = useResources(bookmarkIds)
  const route = useNavRoute()
  const currentBookmarkUrl = bookmarkUrlFromRoute(route)
  const prefs = useSidebarSectionPrefs('bookmarks')
  const setItemOrder = useSetSidebarItemOrder()

  // Pair bookmarks with their resolved entity data for sorting
  const pairedItems = useMemo(() => {
    return bookmarks.map((bookmarkItem, i) => ({
      bookmarkItem,
      entity: bookmarkEntities[i],
    }))
  }, [bookmarks, bookmarkEntities])

  // Apply sort mode
  const sortedItems = useMemo(() => {
    if (prefs.sortMode === 'manual' && prefs.itemOrder.length > 0) {
      return mergeWithUserOrder(prefs.itemOrder, pairedItems, (item) => item.bookmarkItem.url)
    }
    if (prefs.sortMode === 'alphabetical') {
      return [...pairedItems].sort((a, b) => {
        const nameA = a.entity?.data?.type === 'document' ? a.entity.data.document?.metadata?.name || '' : ''
        const nameB = b.entity?.data?.type === 'document' ? b.entity.data.document?.metadata?.name || '' : ''
        return nameA.localeCompare(nameB)
      })
    }
    // activity: return as-is (backend default order)
    return pairedItems
  }, [pairedItems, prefs.sortMode, prefs.itemOrder])

  // DnD for item reordering
  useEffect(() => {
    return monitorForElements({
      onDrop({source, location}) {
        const target = location.current.dropTargets[0]
        if (!target) return
        if (source.data.type !== 'bookmark-item') return
        const sourceUrl = source.data.url as string
        const targetUrl = target.data.url as string
        if (sourceUrl === targetUrl) return
        const currentIds = sortedItems.map((item) => item.bookmarkItem.url)
        const sourceIndex = currentIds.indexOf(sourceUrl)
        const targetIndex = currentIds.indexOf(targetUrl)
        if (sourceIndex === -1 || targetIndex === -1) return
        const edge = extractClosestEdge(target.data)
        const destinationIndex = getReorderDestinationIndex({
          startIndex: sourceIndex,
          indexOfTarget: targetIndex,
          closestEdgeOfTarget: edge,
          axis: 'vertical',
        })
        const newOrder = [...currentIds]
        const [removed] = newOrder.splice(sourceIndex, 1)
        newOrder.splice(destinationIndex, 0, removed)
        setItemOrder.mutate({sectionId: 'bookmarks', itemOrder: newOrder})
      },
    })
  }, [sortedItems, setItemOrder])

  if (!bookmarkEntities.length) return null
  return (
    <SidebarSection title="Bookmarks" sectionId="bookmarks">
      <div>
        {sortedItems.map(({bookmarkItem, entity}) => {
          if (!entity?.data) return null
          if (entity.data.type === 'error') {
            return (
              <DraggableBookmarkItem key={bookmarkItem.url} url={bookmarkItem.url}>
                <ErrorListItem id={entity.data.id} active={currentBookmarkUrl === bookmarkItem.url} />
              </DraggableBookmarkItem>
            )
          }
          if (entity.data.type !== 'document') return null
          const {id, document} = entity.data
          const metadata = id.path?.length
            ? document?.metadata
            : getContactMetadata(id.uid, document?.metadata, contacts.data)
          if (!metadata) return null
          return (
            <DraggableBookmarkItem key={bookmarkItem.url} url={bookmarkItem.url}>
              <BookmarkListItem
                id={id}
                metadata={metadata}
                active={currentBookmarkUrl === bookmarkItem.url}
                visibility={document?.visibility}
                viewTerm={bookmarkItem.viewTerm}
              />
            </DraggableBookmarkItem>
          )
        })}
      </div>
    </SidebarSection>
  )
}

function DraggableBookmarkItem({url, children}: {url: string; children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    if (!ref.current) return
    return combine(
      draggable({
        element: ref.current,
        getInitialData: () => ({type: 'bookmark-item', url}),
      }),
      dropTargetForElements({
        element: ref.current,
        getData: ({input, element}) =>
          attachClosestEdge({type: 'bookmark-item', url}, {input, element, allowedEdges: ['top', 'bottom']}),
        canDrop: ({source}) => source.data.type === 'bookmark-item' && source.data.url !== url,
        onDrag: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragEnter: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [url])

  return (
    <div ref={ref} className="relative" style={{userSelect: 'none'}}>
      <DropIndicatorLine edge={closestEdge} />
      <SidebarMenuItem>{children}</SidebarMenuItem>
    </div>
  )
}

function ErrorListItem({id, active}: {id: UnpackedHypermediaId; active: boolean}) {
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <SmallListItem
      key={id.id}
      docId={id.id}
      active={active}
      title="Error"
      textClass="text-destructive"
      icon={<AlertCircle className="text-destructive size-5" />}
      {...linkProps}
    />
  )
}

const VIEW_TERM_ICONS: Record<string, React.ElementType> = {
  ':comments': MessageSquare,
  ':activity': Quote,
  ':collaborators': Users,
  ':directory': Folder,
  ':feed': History,
}

function BookmarkListItem({
  id,
  metadata,
  active,
  visibility,
  viewTerm,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
  active: boolean
  visibility?: HMResourceVisibility
  viewTerm: ViewTerm | null
}) {
  const navRoute = viewTerm ? createDocumentNavRoute(id, viewTermToRouteKey(viewTerm)) : {key: 'document' as const, id}
  const linkProps = useRouteLink(navRoute)
  const ViewTermIcon = viewTerm ? VIEW_TERM_ICONS[viewTerm] : null
  return (
    <SmallListItem
      key={id.id}
      docId={id.id}
      active={active}
      title={metadata?.name || 'Untitled'}
      icon={<HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} />}
      accessory={
        <>
          {ViewTermIcon ? <ViewTermIcon size={12} className="text-muted-foreground" /> : null}
          {visibility === 'PRIVATE' ? <Lock size={12} /> : null}
        </>
      }
      {...linkProps}
    />
  )
}

function SubscriptionsSection() {
  const selectedAccountId = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  // accountList is already sorted by activity from backend (default sort)
  const accountList = useContactList()
  const prefs = useSidebarSectionPrefs('joined-sites')
  const setItemOrder = useSetSidebarItemOrder()

  // Filter contacts with site subscription, excluding own account
  const siteSubscribedRaw = contacts.data?.filter(
    (contact) => contact.subscribe?.site && contact.subject !== selectedAccountId,
  )

  // Deduplicate by subject — the same site may have been joined multiple times
  const siteSubscribed = siteSubscribedRaw
    ? Object.values(
        siteSubscribedRaw.reduce<Record<string, (typeof siteSubscribedRaw)[0]>>((acc, contact) => {
          if (!acc[contact.subject]) acc[contact.subject] = contact
          return acc
        }, {}),
      )
    : undefined

  // Fetch site resources for all joined sites to ensure metadata is available
  const siteIds = siteSubscribed?.map((contact) => hmId(contact.subject)) || []
  const siteResources = useResources(siteIds, {subscribed: true})

  // Sort by activity using the backend's account order (already sorted by activity desc)
  const accounts = accountList.data?.accounts || []
  const activitySorted = useMemo(() => {
    return [...(siteSubscribed || [])].sort((a, b) => {
      const indexA = accounts.findIndex((acc) => acc.id === a.subject)
      const indexB = accounts.findIndex((acc) => acc.id === b.subject)
      if (indexA === -1 && indexB === -1) return 0
      if (indexA === -1) return 1
      if (indexB === -1) return -1
      return indexA - indexB
    })
  }, [siteSubscribed, accounts])

  // Apply sort mode
  const sortedContacts = useMemo(() => {
    if (prefs.sortMode === 'manual' && prefs.itemOrder.length > 0) {
      return mergeWithUserOrder(prefs.itemOrder, activitySorted, (c) => c.subject)
    }
    if (prefs.sortMode === 'alphabetical') {
      const accountsMetadata = accountList.data?.accountsMetadata
      return [...activitySorted].sort((a, b) => {
        const nameA = a.name || accountsMetadata?.[a.subject]?.metadata?.name || ''
        const nameB = b.name || accountsMetadata?.[b.subject]?.metadata?.name || ''
        return nameA.localeCompare(nameB)
      })
    }
    return activitySorted
  }, [activitySorted, prefs.sortMode, prefs.itemOrder, accountList.data])

  const route = useNavRoute()
  const accountsMetadata = accountList.data?.accountsMetadata

  // Fetch document-level activity
  const subscribedDocs = useSubscribedDocuments()

  // Fetch comments for account-level activity
  const commentIds = accounts
    .map((acc) => acc.activitySummary?.latestCommentId)
    .filter((id): id is string => !!id && id.length > 0)
    .map((id) => hmId(id))
  const comments = useComments(commentIds)

  // DnD for item reordering
  useEffect(() => {
    return monitorForElements({
      onDrop({source, location}) {
        const target = location.current.dropTargets[0]
        if (!target) return
        if (source.data.type !== 'subscription-item') return
        const sourceSubject = source.data.subject as string
        const targetSubject = target.data.subject as string
        if (sourceSubject === targetSubject) return
        const currentIds = sortedContacts.map((c) => c.subject)
        const sourceIndex = currentIds.indexOf(sourceSubject)
        const targetIndex = currentIds.indexOf(targetSubject)
        if (sourceIndex === -1 || targetIndex === -1) return
        const edge = extractClosestEdge(target.data)
        const destinationIndex = getReorderDestinationIndex({
          startIndex: sourceIndex,
          indexOfTarget: targetIndex,
          closestEdgeOfTarget: edge,
          axis: 'vertical',
        })
        const newOrder = [...currentIds]
        const [removed] = newOrder.splice(sourceIndex, 1)
        newOrder.splice(destinationIndex, 0, removed)
        setItemOrder.mutate({sectionId: 'joined-sites', itemOrder: newOrder})
      },
    })
  }, [sortedContacts, setItemOrder])

  return (
    <SidebarSection title="Joined Sites" sectionId="joined-sites">
      <div>
        {sortedContacts.length ? (
          sortedContacts.map((contact) => {
            const id = hmId(contact.subject)
            const account = accounts.find((acc) => acc.id === contact.subject)
            const accountMeta = accountsMetadata?.[contact.subject]
            const siteResource = siteResources.find((r) => r.data?.id?.uid === contact.subject)
            const siteMeta = siteResource?.data?.type === 'document' ? siteResource.data.document?.metadata : undefined

            const name = contact.name || siteMeta?.name || accountMeta?.metadata?.name || account?.metadata?.name
            const icon = siteMeta?.icon || accountMeta?.metadata?.icon || account?.metadata?.icon
            const metadata: HMMetadata = {name, icon}

            if (!name && siteResource?.isLoading) return null
            if (!name) return null

            const docData = subscribedDocs.data?.get(id.id)

            let activitySummary: HMActivitySummary | undefined
            let latestComment: HMComment | undefined

            if (account?.activitySummary) {
              activitySummary = account.activitySummary as HMActivitySummary
              latestComment = activitySummary?.latestCommentId
                ? comments.data?.find((c) => c?.id === activitySummary?.latestCommentId)
                : undefined
            } else {
              activitySummary = docData?.activitySummary
              latestComment = docData?.latestComment ?? undefined
            }

            const isUnread = activitySummary?.isUnread ?? false
            return (
              <DraggableSubscriptionItem key={id.id} subject={contact.subject}>
                <JoinedSiteListItem
                  id={id}
                  contact={contact}
                  metadata={metadata}
                  active={route.key === 'document' && route.id.id === id.id}
                  isUnread={isUnread}
                  activitySummary={activitySummary}
                  latestComment={latestComment}
                  accountsMetadata={accountsMetadata}
                />
              </DraggableSubscriptionItem>
            )
          })
        ) : (
          <SidebarMenuItem>
            <div className="text-muted-foreground flex items-center justify-center px-4 pb-3 text-center text-xs leading-relaxed select-none">
              Click "Join" on a site to get started.
            </div>
          </SidebarMenuItem>
        )}
      </div>
    </SidebarSection>
  )
}

function DraggableSubscriptionItem({subject, children}: {subject: string; children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    if (!ref.current) return
    return combine(
      draggable({
        element: ref.current,
        getInitialData: () => ({type: 'subscription-item', subject}),
      }),
      dropTargetForElements({
        element: ref.current,
        getData: ({input, element}) =>
          attachClosestEdge({type: 'subscription-item', subject}, {input, element, allowedEdges: ['top', 'bottom']}),
        canDrop: ({source}) => source.data.type === 'subscription-item' && source.data.subject !== subject,
        onDrag: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragEnter: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [subject])

  return (
    <div ref={ref} className="relative" style={{userSelect: 'none'}}>
      <DropIndicatorLine edge={closestEdge} />
      <SidebarMenuItem>{children}</SidebarMenuItem>
    </div>
  )
}

/** Sidebar item for a joined site with leave functionality. */
function JoinedSiteListItem({
  id,
  contact,
  metadata,
  active,
  isUnread,
  activitySummary,
  latestComment,
  accountsMetadata,
}: {
  id: UnpackedHypermediaId
  contact: HMContactRecord
  metadata: HMMetadata
  active: boolean
  isUnread: boolean
  activitySummary?: HMActivitySummary
  latestComment?: HMComment
  accountsMetadata?: HMAccountsMetadata
}) {
  const linkProps = useRouteLink({key: 'document', id})
  const {leaveSite, isPending} = useLeaveSite({siteUid: contact.subject})
  return (
    <>
      <SidebarMenuButton isActive={active} className="min-h-10 items-start pr-8" onClick={linkProps.onClick}>
        <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} className="mt-0.5 shrink-0 self-center" />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <span className={cn('truncate text-left text-sm select-none', isUnread && 'font-bold')}>
            {metadata?.name || 'Untitled'}
          </span>
          {activitySummary && (
            <LibraryEntryUpdateSummary
              accountsMetadata={accountsMetadata}
              latestComment={latestComment}
              activitySummary={activitySummary}
            />
          )}
        </div>
      </SidebarMenuButton>
      <SidebarMenuAction>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="hover:bg-sidebar-accent flex items-center justify-center rounded-md p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem
              variant="destructive"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation()
                leaveSite()
              }}
            >
              <CircleOff className="size-4" />
              Leave Site
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuAction>
    </>
  )
}

/** Section showing profiles the user is following. */
function FollowingSection() {
  const selectedAccountId = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const accountList = useContactList()
  const prefs = useSidebarSectionPrefs('following')
  const setItemOrder = useSetSidebarItemOrder()

  // Filter contacts with profile subscription, excluding own account
  const profileSubscribedRaw = contacts.data?.filter(
    (contact) => hasProfileSubscription(contact) && contact.subject !== selectedAccountId,
  )

  // Deduplicate by subject
  const profileSubscribed = profileSubscribedRaw
    ? Object.values(
        profileSubscribedRaw.reduce<Record<string, (typeof profileSubscribedRaw)[0]>>((acc, contact) => {
          if (!acc[contact.subject]) acc[contact.subject] = contact
          return acc
        }, {}),
      )
    : undefined

  // Fetch profile resources for all followed contacts to ensure metadata is available
  const profileIds = profileSubscribed?.map((contact) => hmId(contact.subject)) || []
  const profileResources = useResources(profileIds, {subscribed: true})

  // Sort by activity using the backend's account order
  const accounts = accountList.data?.accounts || []
  const activitySorted = useMemo(() => {
    return [...(profileSubscribed || [])].sort((a, b) => {
      const indexA = accounts.findIndex((acc) => acc.id === a.subject)
      const indexB = accounts.findIndex((acc) => acc.id === b.subject)
      if (indexA === -1 && indexB === -1) return 0
      if (indexA === -1) return 1
      if (indexB === -1) return -1
      return indexA - indexB
    })
  }, [profileSubscribed, accounts])

  // Apply sort mode
  const accountsMetadata = accountList.data?.accountsMetadata
  const sortedContacts = useMemo(() => {
    if (prefs.sortMode === 'manual' && prefs.itemOrder.length > 0) {
      return mergeWithUserOrder(prefs.itemOrder, activitySorted, (c) => c.subject)
    }
    if (prefs.sortMode === 'alphabetical') {
      return [...activitySorted].sort((a, b) => {
        const nameA = a.name || accountsMetadata?.[a.subject]?.metadata?.name || ''
        const nameB = b.name || accountsMetadata?.[b.subject]?.metadata?.name || ''
        return nameA.localeCompare(nameB)
      })
    }
    return activitySorted
  }, [activitySorted, prefs.sortMode, prefs.itemOrder, accountsMetadata])

  const route = useNavRoute()

  // DnD for item reordering
  useEffect(() => {
    return monitorForElements({
      onDrop({source, location}) {
        const target = location.current.dropTargets[0]
        if (!target) return
        if (source.data.type !== 'following-item') return
        const sourceSubject = source.data.subject as string
        const targetSubject = target.data.subject as string
        if (sourceSubject === targetSubject) return
        const currentIds = sortedContacts.map((c) => c.subject)
        const sourceIndex = currentIds.indexOf(sourceSubject)
        const targetIndex = currentIds.indexOf(targetSubject)
        if (sourceIndex === -1 || targetIndex === -1) return
        const edge = extractClosestEdge(target.data)
        const destinationIndex = getReorderDestinationIndex({
          startIndex: sourceIndex,
          indexOfTarget: targetIndex,
          closestEdgeOfTarget: edge,
          axis: 'vertical',
        })
        const newOrder = [...currentIds]
        const [removed] = newOrder.splice(sourceIndex, 1)
        newOrder.splice(destinationIndex, 0, removed)
        setItemOrder.mutate({sectionId: 'following', itemOrder: newOrder})
      },
    })
  }, [sortedContacts, setItemOrder])

  if (!sortedContacts.length) return null

  return (
    <SidebarSection title="Following" sectionId="following">
      <div>
        {sortedContacts.map((contact) => {
          const id = hmId(contact.subject)
          const account = accounts.find((acc) => acc.id === contact.subject)
          const accountMeta = accountsMetadata?.[contact.subject]
          const profileResource = profileResources.find((r) => r.data?.id?.uid === contact.subject)
          const profileMeta =
            profileResource?.data?.type === 'document' ? profileResource.data.document?.metadata : undefined

          const name = contact.name || profileMeta?.name || accountMeta?.metadata?.name || account?.metadata?.name
          const icon = profileMeta?.icon || accountMeta?.metadata?.icon || account?.metadata?.icon
          const metadata: HMMetadata = {name, icon}

          if (!name && profileResource?.isLoading) return null
          if (!name) return null

          return (
            <DraggableFollowingItem key={id.id} subject={contact.subject}>
              <FollowingListItem
                id={id}
                contact={contact}
                metadata={metadata}
                active={route.key === 'profile' && route.id.id === id.id}
              />
            </DraggableFollowingItem>
          )
        })}
      </div>
    </SidebarSection>
  )
}

function DraggableFollowingItem({subject, children}: {subject: string; children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    if (!ref.current) return
    return combine(
      draggable({
        element: ref.current,
        getInitialData: () => ({type: 'following-item', subject}),
      }),
      dropTargetForElements({
        element: ref.current,
        getData: ({input, element}) =>
          attachClosestEdge({type: 'following-item', subject}, {input, element, allowedEdges: ['top', 'bottom']}),
        canDrop: ({source}) => source.data.type === 'following-item' && source.data.subject !== subject,
        onDrag: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragEnter: ({self}) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [subject])

  return (
    <div ref={ref} className="relative" style={{userSelect: 'none'}}>
      <DropIndicatorLine edge={closestEdge} />
      <SidebarMenuItem>{children}</SidebarMenuItem>
    </div>
  )
}

/** Sidebar item for a followed profile with unfollow functionality. */
function FollowingListItem({
  id,
  contact,
  metadata,
  active,
}: {
  id: UnpackedHypermediaId
  contact: HMContactRecord
  metadata: HMMetadata
  active: boolean
}) {
  const linkProps = useRouteLink({key: 'profile', id})
  const {unfollowProfile, isPending} = useFollowProfile({profileUid: contact.subject})
  return (
    <>
      <SidebarMenuButton isActive={active} className="min-h-10 items-center pr-8" onClick={linkProps.onClick}>
        <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} className="shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <span className="truncate text-left text-sm font-bold select-none">{metadata?.name || 'Untitled'}</span>
        </div>
      </SidebarMenuButton>
      <SidebarMenuAction>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="hover:bg-sidebar-accent flex items-center justify-center rounded-md p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem
              variant="destructive"
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation()
                unfollowProfile()
              }}
            >
              <CircleOff className="size-4" />
              Unfollow
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuAction>
    </>
  )
}

function MySiteSection({selectedAccountId}: {selectedAccountId?: string}) {
  const resource = useResource(selectedAccountId ? hmId(selectedAccountId) : undefined)
  const imageUrl = useImageUrl()
  const navigate = useNavigate()

  if (!selectedAccountId) return null

  // Account has a home document — show the existing site section
  if (resource.data?.type === 'document' && resource.data.document) {
    const {document} = resource.data
    return (
      <SidebarGroup className="mt-4">
        <div className="flex items-center justify-between px-2">
          <SidebarGroupLabel className="group/header hover:bg-border flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 tracking-normal normal-case">
            <SizableText
              weight="bold"
              size="xs"
              color="muted"
              className="group-hover/header:text-foreground flex-1 capitalize select-none"
            >
              My Site
            </SizableText>
          </SidebarGroupLabel>
        </div>
        <SidebarGroupContent>
          <SidebarMenu>
            <div
              className="border-border hover:bg-sidebar-accent my-2 flex cursor-pointer items-center gap-2 rounded-lg border p-2"
              onClick={() => navigate({key: 'document', id: hmId(selectedAccountId)})}
            >
              <UIAvatar
                id={selectedAccountId}
                label={document.metadata.name}
                size={40}
                url={document.metadata.icon ? imageUrl(document.metadata.icon) : ''}
                className="shrink-0"
              />
              <span className="truncate text-sm font-bold select-none">{document.metadata.name}</span>
            </div>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    )
  }

  // Account has no home document — show a CTA to create one.
  if (resource.isInitialLoading || resource.isDiscovering) return null

  return (
    <SidebarGroup className="mt-4">
      <div className="flex items-center justify-between px-2">
        <SidebarGroupLabel className="group/header hover:bg-border flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 tracking-normal normal-case">
          <SizableText
            weight="bold"
            size="xs"
            color="muted"
            className="group-hover/header:text-foreground flex-1 capitalize select-none"
          >
            My Site
          </SizableText>
        </SidebarGroupLabel>
      </div>
      <SidebarGroupContent>
        <SidebarMenu>
          <Tooltip content="Create your site to publish documents and share your profile.">
            <Button
              className="w-full"
              variant="default"
              onClick={() =>
                navigate({
                  key: 'draft',
                  id: nanoid(10),
                  editUid: selectedAccountId,
                  editPath: [],
                })
              }
            >
              Create my Site
            </Button>
          </Tooltip>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
