import {useContactList} from '@/models/contacts'
import {
  isJoinedSiteDragBlocked,
  JoinedSiteDropEdge,
  reorderJoinedSites,
  reorderJoinedSitesAtEdge,
  useJoinedSiteOrder,
} from '@/models/joined-site-order'
import {useSubscribedDocuments} from '@/models/library'
import {grpcClient} from '@/grpc-client'
import {useSelectedAccountId} from '@/selected-account'
import {useCreateSpaceDialog} from './create-space-dialog'
import {useNavigate} from '@/utils/useNavigate'
import {HMContactRecord, HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements, monitorForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {defaultJoinedSiteUid, useRouteLink} from '@shm/shared'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hasProfileSubscription, useFollowProfile, useLeaveSite} from '@shm/shared/models/join-site'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
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
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {ArrowDown, ArrowUp, Bot, ChevronDown, ChevronRight, LayoutList, MoreHorizontal, Settings} from 'lucide-react'
import React, {memo} from 'react'
import {CreateDocumentButton} from './create-doc-button'
import {isSiteDocumentsActiveRoute} from './sidebar-active'
import {GenericSidebarContainer} from './sidebar-base'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  const selectedSite = useResource(selectedAccountId ? hmId(selectedAccountId) : undefined)
  const contacts = useSelectedAccountContacts()
  const hasSelectedSite = selectedSite.data?.type === 'document' && selectedSite.data.document
  const joinedSiteCount = selectedAccountId
    ? new Set(
        (contacts.data ?? [])
          .filter((contact) => contact.subscribe?.site && contact.subject !== selectedAccountId)
          .map((contact) => contact.subject),
      ).size
    : 1
  const isCheckingOnboardingVisibility =
    !!selectedAccountId && (contacts.isLoading || selectedSite.isInitialLoading || selectedSite.isDiscovering)
  const shouldShowOnboarding = !isCheckingOnboardingVisibility && !hasSelectedSite && joinedSiteCount < 2
  return (
    <GenericSidebarContainer
      footer={({isVisible}) => (
        <SidebarFooterLayout className="gap-0 p-0">
          <SidebarMenu className="px-2 pb-3">
            {shouldShowOnboarding ? (
              <SidebarMenuItem>
                <SmallListItem
                  onClick={() => {
                    navigate({key: 'onboarding'})
                  }}
                  title="Get Started with Seed"
                  bold
                  className="min-h-12 w-full border border-dashed border-neutral-400 bg-transparent py-2 hover:border-neutral-600 hover:bg-transparent dark:border-neutral-600 dark:hover:border-neutral-400 dark:hover:bg-transparent"
                  icon={<span className="h-2 w-2 rounded-full bg-emerald-500" />}
                  rightHover={[]}
                />
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
          <SidebarSeparator />
          <SidebarMenu className="py-4">
            <SidebarMenuItem>
              <SmallListItem
                active={route.key == 'agents'}
                onClick={() => {
                  navigate({key: 'agents'})
                }}
                icon={<Bot className="size-4" />}
                title="Agents"
                bold
              />
            </SidebarMenuItem>
            {/* <SidebarMenuItem>
              <SmallListItem
                active={route.key == 'contacts'}
                onClick={() => {
                  navigate({key: 'contacts'})
                }}
                icon={<Contact className="size-4" />}
                title="Contacts"
                bold
              />
            </SidebarMenuItem> */}
          </SidebarMenu>
        </SidebarFooterLayout>
      )}
    >
      <SidebarHeader>
        <CreateDocumentButton />
      </SidebarHeader>
      <SidebarContent>
        <MySiteSection selectedAccountId={selectedAccountId ?? undefined} />
        <SubscriptionsSection />
        <FollowingSection />
      </SidebarContent>
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
  let Icon = collapsed ? ChevronRight : ChevronDown
  return (
    <SidebarGroup className="mt-4">
      <div className="flex items-center justify-between px-2">
        <SidebarGroupLabel
          className="group/header hover:bg-border flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 tracking-normal normal-case"
          onClick={() => {
            setCollapsed(!collapsed)
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
        {accessory ? <div className="flex">{accessory}</div> : null}
      </div>
      {collapsed ? null : (
        <SidebarGroupContent>
          <SidebarMenu>{children}</SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

function SubscriptionsSection() {
  const selectedAccountId = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const accountList = useContactList()

  const defaultJoinedSiteContact: HMContactRecord = {
    id: `default-joined-site:${defaultJoinedSiteUid}`,
    subject: defaultJoinedSiteUid,
    name: '',
    account: '',
    signer: '',
    subscribe: {site: true},
  }

  React.useEffect(() => {
    if (selectedAccountId) return
    grpcClient.subscriptions
      .subscribe({
        account: defaultJoinedSiteUid,
        path: '',
        recursive: true,
      })
      .then(() => {
        invalidateQueries([queryKeys.SUBSCRIPTIONS])
      })
      .catch((error) => {
        console.error('Failed to subscribe to default joined site', error)
      })
  }, [selectedAccountId])

  // Filter contacts with site subscription, excluding own account. Before an
  // account exists, show the default joined site so the sidebar isn't empty.
  const siteSubscribedRaw = selectedAccountId
    ? contacts.data?.filter((contact) => contact.subscribe?.site && contact.subject !== selectedAccountId)
    : [defaultJoinedSiteContact]

  // Deduplicate by subject — the same site may have been joined multiple times
  // (e.g. via delegated keys or repeated join actions), each creating a separate
  // contact record with a unique tsid. The backend returns contacts ordered by
  // id DESC (most recent first), so the first occurrence per subject wins.
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

  const accounts = accountList.data?.accounts || []
  const sourceOrder = siteSubscribed?.map((contact) => contact.subject) ?? []
  const {order, persistOrder} = useJoinedSiteOrder({
    identityUid: selectedAccountId,
    sourceOrder,
    isAuthoritative: !!selectedAccountId && contacts.isSuccess && !contacts.isFetching,
  })
  const contactsByUid = new Map(siteSubscribed?.map((contact) => [contact.subject, contact]))
  const orderedContacts = order.map((siteUid) => contactsByUid.get(siteUid)).filter((contact) => !!contact)
  const [dropIndicator, setDropIndicator] = React.useState<{siteUid: string; edge: JoinedSiteDropEdge} | null>(null)
  const [reorderAnnouncement, setReorderAnnouncement] = React.useState('')

  React.useEffect(() => {
    return monitorForElements({
      onDrag: ({source, location}) => {
        if (source.data.type !== 'joined-site') return
        const target = location.current.dropTargets.find((dropTarget) => dropTarget.data.type === 'joined-site')
        const targetUid = target?.data.siteUid
        const edge = target?.data.edge
        if (typeof targetUid !== 'string' || (edge !== 'top' && edge !== 'bottom')) {
          setDropIndicator(null)
          return
        }
        const nextOrder = reorderJoinedSitesAtEdge(order, source.data.siteUid as string, targetUid, edge)
        setDropIndicator(nextOrder ? {siteUid: targetUid, edge} : null)
      },
      onDrop: ({source, location}) => {
        if (source.data.type !== 'joined-site') return
        setDropIndicator(null)
        const target = location.current.dropTargets.find((dropTarget) => dropTarget.data.type === 'joined-site')
        const targetUid = target?.data.siteUid
        const edge = target?.data.edge
        if (typeof targetUid !== 'string' || (edge !== 'top' && edge !== 'bottom')) return
        const nextOrder = reorderJoinedSitesAtEdge(order, source.data.siteUid as string, targetUid, edge)
        if (nextOrder) persistOrder(nextOrder)
      },
    })
  }, [order, persistOrder])

  function moveSite(siteUid: string, siteName: string, direction: -1 | 1) {
    const from = order.indexOf(siteUid)
    const targetUid = order[from + direction]
    if (from === -1 || !targetUid) return
    const nextOrder = reorderJoinedSites(order, siteUid, targetUid)
    if (!nextOrder) return
    persistOrder(nextOrder)
    setReorderAnnouncement(`${siteName} moved to position ${nextOrder.indexOf(siteUid) + 1}`)
  }

  const route = useNavRoute()

  const accountsMetadata = accountList.data?.accountsMetadata
  const subscribedDocs = useSubscribedDocuments()

  return (
    <SidebarSection title="Joined Spaces">
      <span className="sr-only" aria-live="polite">
        {reorderAnnouncement}
      </span>
      {orderedContacts.length ? (
        orderedContacts.map((contact, index) => {
          const id = hmId(contact.subject)
          // Get account from the backend's account list (has metadata)
          const account = accounts.find((acc) => acc.id === contact.subject)
          const accountMeta = accountsMetadata?.[contact.subject]
          // Get metadata from fetched site resource (most reliable source)
          const siteResource = siteResources.find((r) => r.data?.id?.uid === contact.subject)
          const siteMeta = siteResource?.data?.type === 'document' ? siteResource.data.document?.metadata : undefined

          // Build metadata: prefer contact name, then site resource, then account metadata
          const name = contact.name || siteMeta?.name || accountMeta?.metadata?.name || account?.metadata?.name
          const icon = siteMeta?.icon || accountMeta?.metadata?.icon || account?.metadata?.icon
          const metadata: HMMetadata = {name, icon}

          // Skip if no name and still loading, except for the pre-account default site.
          if (!name && siteResource?.isLoading && selectedAccountId) return null
          if (!name && selectedAccountId) return null

          const isUnread =
            account?.activitySummary?.isUnread ?? subscribedDocs.data?.get(id.id)?.activitySummary?.isUnread ?? false
          return (
            <SidebarMenuItem key={id.id}>
              <JoinedSiteListItem
                id={id}
                contact={contact}
                metadata={metadata}
                active={isSiteDocumentsActiveRoute(route, id)}
                isUnread={isUnread}
                canLeave={!!selectedAccountId}
                dropEdge={dropIndicator?.siteUid === contact.subject ? dropIndicator.edge : null}
                canMoveUp={index > 0}
                canMoveDown={index < orderedContacts.length - 1}
                onMoveUp={() => moveSite(contact.subject, metadata.name || 'Untitled', -1)}
                onMoveDown={() => moveSite(contact.subject, metadata.name || 'Untitled', 1)}
              />
            </SidebarMenuItem>
          )
        })
      ) : (
        <SidebarMenuItem>
          <div className="text-muted-foreground flex items-center justify-center px-4 pb-3 text-center text-xs leading-relaxed select-none">
            Click "Join" on a space to get started.
          </div>
        </SidebarMenuItem>
      )}
    </SidebarSection>
  )
}

/** Sidebar item for a joined site with leave functionality. */
function JoinedSiteListItem({
  id,
  contact,
  metadata,
  active,
  isUnread,
  canLeave = true,
  dropEdge,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  id: UnpackedHypermediaId
  contact: HMContactRecord
  metadata: HMMetadata
  active: boolean
  isUnread: boolean
  canLeave?: boolean
  dropEdge: JoinedSiteDropEdge | null
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const linkProps = useRouteLink({key: 'document', id})
  const navigate = useNavigate()
  const {leaveSite, isPending} = useLeaveSite({siteUid: contact.subject})
  const rowRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!rowRef.current) return
    const data = {type: 'joined-site', siteUid: contact.subject}
    return combine(
      draggable({
        element: rowRef.current,
        canDrag: ({input}) => !isJoinedSiteDragBlocked(document.elementFromPoint(input.clientX, input.clientY)),
        getInitialData: () => data,
      }),
      dropTargetForElements({
        element: rowRef.current,
        getData: ({input, element}) => {
          const rect = element.getBoundingClientRect()
          return {...data, edge: input.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'}
        },
      }),
    )
  }, [contact.subject])

  return (
    <div ref={rowRef} className="group/joined-site relative cursor-grab rounded-md active:cursor-grabbing">
      {dropEdge ? (
        <div
          className={cn(
            'bg-primary pointer-events-none absolute right-0 left-0 z-20 h-0.5 rounded-full',
            dropEdge === 'top' ? '-top-px' : '-bottom-px',
          )}
        >
          <span className="bg-primary absolute top-1/2 left-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
        </div>
      ) : null}
      <SidebarMenuButton
        isActive={active}
        className={cn(
          'min-h-10 items-center pr-8',
          active &&
            'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:hover:bg-accent/90 data-[active=true]:hover:text-accent-foreground',
        )}
        onClick={linkProps.onClick}
      >
        <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} className="shrink-0" />
        <span className={cn('min-w-0 flex-1 truncate text-left text-sm select-none', isUnread && 'font-bold')}>
          {metadata?.name || 'Untitled'}
        </span>
      </SidebarMenuButton>
      <OptionsDropdown
        side="right"
        align="start"
        button={
          <SidebarMenuAction
            data-no-joined-site-drag
            aria-label="Joined space options"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </SidebarMenuAction>
        }
        menuItems={[
          {
            key: 'move-up',
            label: 'Move Up',
            icon: <ArrowUp className="size-4" />,
            disabled: !canMoveUp,
            onClick: onMoveUp,
          },
          {
            key: 'move-down',
            label: 'Move Down',
            icon: <ArrowDown className="size-4" />,
            disabled: !canMoveDown,
            onClick: onMoveDown,
          },
          {
            key: 'all-documents',
            label: 'All Documents',
            icon: <LayoutList className="size-4" />,
            onClick: () => navigate({key: 'all-documents', id}),
          },
          ...(canLeave
            ? [
                {
                  key: 'leave',
                  label: 'Leave Space',
                  icon: <CircleOff className="size-4" />,
                  variant: 'destructive' as const,
                  disabled: isPending,
                  onClick: () => leaveSite(),
                },
              ]
            : []),
        ]}
      />
    </div>
  )
}

/** Section showing profiles the user is following. */
function FollowingSection() {
  const selectedAccountId = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  const accountList = useContactList()

  // Filter contacts with profile subscription, excluding own account
  const profileSubscribedRaw = contacts.data?.filter(
    (contact) => hasProfileSubscription(contact) && contact.subject !== selectedAccountId,
  )

  // Deduplicate by subject — same account may appear multiple times with different tsids.
  // The backend returns contacts ordered by id DESC (most recent first), so the
  // first occurrence per subject wins.
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
  const sortedContacts = [...(profileSubscribed || [])].sort((a, b) => {
    const indexA = accounts.findIndex((acc) => acc.id === a.subject)
    const indexB = accounts.findIndex((acc) => acc.id === b.subject)
    if (indexA === -1 && indexB === -1) return 0
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })

  const route = useNavRoute()
  const accountsMetadata = accountList.data?.accountsMetadata

  if (!sortedContacts.length) return null

  return (
    <SidebarSection title="Following">
      {sortedContacts.map((contact) => {
        const id = hmId(contact.subject)
        const account = accounts.find((acc) => acc.id === contact.subject)
        const accountMeta = accountsMetadata?.[contact.subject]
        // Get metadata from fetched profile resource (most reliable source)
        const profileResource = profileResources.find((r) => r.data?.id?.uid === contact.subject)
        const profileMeta =
          profileResource?.data?.type === 'document' ? profileResource.data.document?.metadata : undefined

        // Priority: contact name > profile resource metadata > accountMeta > account metadata
        const name = contact.name || profileMeta?.name || accountMeta?.metadata?.name || account?.metadata?.name
        const icon = profileMeta?.icon || accountMeta?.metadata?.icon || account?.metadata?.icon
        const metadata: HMMetadata = {name, icon}

        // Skip if no name and still loading
        if (!name && profileResource?.isLoading) return null
        if (!name) return null

        return (
          <SidebarMenuItem key={id.id}>
            <FollowingListItem
              id={id}
              contact={contact}
              metadata={metadata}
              active={route.key === 'profile' && route.id.id === id.id}
            />
          </SidebarMenuItem>
        )
      })}
    </SidebarSection>
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
      <OptionsDropdown
        side="right"
        align="start"
        button={
          <SidebarMenuAction aria-label="Following options" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-4" />
          </SidebarMenuAction>
        }
        menuItems={[
          {
            key: 'unfollow',
            label: 'Unfollow',
            icon: <CircleOff className="size-4" />,
            variant: 'destructive',
            disabled: isPending,
            onClick: () => unfollowProfile(),
          },
        ]}
      />
    </>
  )
}

function MySiteSection({selectedAccountId}: {selectedAccountId?: string}) {
  const siteId = selectedAccountId ? hmId(selectedAccountId) : undefined
  const resource = useResource(siteId)
  const imageUrl = useImageUrl()
  const navigate = useNavigate()
  const route = useNavRoute()
  const active = siteId ? isSiteDocumentsActiveRoute(route, siteId) : false
  const createSpaceDialog = useCreateSpaceDialog()

  if (!selectedAccountId) return null

  // Account has a home document — show the existing site section
  if (resource.data?.type === 'document' && resource.data.document) {
    const {document} = resource.data
    return (
      <SidebarSection title="My Space">
        <div className="relative">
          <div
            className={cn(
              'border-border hover:bg-sidebar-accent my-2 flex cursor-pointer items-center gap-2 rounded-lg border p-2 pr-8',
              active && 'border-accent bg-accent text-accent-foreground hover:bg-accent/90',
            )}
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
          <OptionsDropdown
            side="right"
            align="start"
            button={
              <button
                aria-label="My space options"
                className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md hover:bg-black/10 dark:hover:bg-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-4" />
              </button>
            }
            menuItems={[
              {
                key: 'all-documents',
                label: 'All Documents',
                icon: <LayoutList className="size-4" />,
                onClick: () => navigate({key: 'all-documents', id: hmId(selectedAccountId)}),
              },
              {
                key: 'site-settings',
                label: 'Space settings',
                icon: <Settings className="size-4" />,
                onClick: () => navigate({key: 'site-settings', id: hmId(selectedAccountId)}),
              },
            ]}
          />
        </div>
      </SidebarSection>
    )
  }

  // Account has no home document — show a CTA to create one.
  // Don't show CTA while still loading/discovering.
  if (resource.isInitialLoading || resource.isDiscovering) return null

  return (
    <SidebarSection title="My Space">
      <Tooltip content="Create your space to publish documents and share your profile.">
        <Button className="w-full" variant="default" onClick={() => createSpaceDialog.open()}>
          Create my Space
        </Button>
      </Tooltip>
      {createSpaceDialog.content}
    </SidebarSection>
  )
}
