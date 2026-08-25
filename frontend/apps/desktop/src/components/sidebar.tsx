import {useComments} from '@/models/comments'
import {useContactList} from '@/models/contacts'
import {useSubscribedDocuments} from '@/models/library'
import {grpcClient} from '@/grpc-client'
import {useSelectedAccountId} from '@/selected-account'
import {useCreateSpaceDialog} from './create-space-dialog'
import {useNavigate} from '@/utils/useNavigate'
import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMComment,
  HMContactRecord,
  HMMetadata,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {defaultJoinedSpaceUid, useRouteLink} from '@shm/shared'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hasProfileSubscription, useFollowProfile, useLeaveSpace} from '@shm/shared/models/join-space'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {LibraryEntryUpdateSummary} from '@shm/ui/activity'
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
import {Bot, ChevronDown, ChevronRight, LayoutList, MoreHorizontal, Settings} from 'lucide-react'
import React, {memo} from 'react'
import {CreateDocumentButton} from './create-doc-button'
import {isSpaceDocumentsActiveRoute} from './sidebar-active'
import {GenericSidebarContainer} from './sidebar-base'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  const selectedSpace = useResource(selectedAccountId ? hmId(selectedAccountId) : undefined)
  const contacts = useSelectedAccountContacts()
  const hasSelectedSpace = selectedSpace.data?.type === 'document' && selectedSpace.data.document
  const joinedSpaceCount = selectedAccountId
    ? new Set(
        (contacts.data ?? [])
          .filter((contact) => contact.subscribe?.site && contact.subject !== selectedAccountId)
          .map((contact) => contact.subject),
      ).size
    : 1
  const isCheckingOnboardingVisibility =
    !!selectedAccountId && (contacts.isLoading || selectedSpace.isInitialLoading || selectedSpace.isDiscovering)
  const shouldShowOnboarding = !isCheckingOnboardingVisibility && !hasSelectedSpace && joinedSpaceCount < 2
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
        <MySpaceSection selectedAccountId={selectedAccountId ?? undefined} />
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
  // accountList is already sorted by activity from backend (default sort)
  const accountList = useContactList()

  const defaultJoinedSpaceContact: HMContactRecord = {
    id: `default-joined-space:${defaultJoinedSpaceUid}`,
    subject: defaultJoinedSpaceUid,
    name: '',
    account: '',
    signer: '',
    subscribe: {site: true},
  }

  React.useEffect(() => {
    if (selectedAccountId) return
    grpcClient.subscriptions
      .subscribe({
        account: defaultJoinedSpaceUid,
        path: '',
        recursive: true,
      })
      .then(() => {
        invalidateQueries([queryKeys.SUBSCRIPTIONS])
      })
      .catch((error) => {
        console.error('Failed to subscribe to default joined space', error)
      })
  }, [selectedAccountId])

  // Filter contacts with space subscription, excluding own account. Before an
  // account exists, show the default joined space so the sidebar isn't empty.
  const spaceSubscribedRaw = selectedAccountId
    ? contacts.data?.filter((contact) => contact.subscribe?.site && contact.subject !== selectedAccountId)
    : [defaultJoinedSpaceContact]

  // Deduplicate by subject — the same space may have been joined multiple times
  // (e.g. via delegated keys or repeated join actions), each creating a separate
  // contact record with a unique tsid. The backend returns contacts ordered by
  // id DESC (most recent first), so the first occurrence per subject wins.
  const spaceSubscribed = spaceSubscribedRaw
    ? Object.values(
        spaceSubscribedRaw.reduce<Record<string, (typeof spaceSubscribedRaw)[0]>>((acc, contact) => {
          if (!acc[contact.subject]) acc[contact.subject] = contact
          return acc
        }, {}),
      )
    : undefined

  // Fetch space resources for all joined spaces to ensure metadata is available
  const spaceIds = spaceSubscribed?.map((contact) => hmId(contact.subject)) || []
  const spaceResources = useResources(spaceIds, {subscribed: true})

  // Sort by activity using the backend's account order (already sorted by activity desc)
  const accounts = accountList.data?.accounts || []
  const sortedContacts = [...(spaceSubscribed || [])].sort((a, b) => {
    const indexA = accounts.findIndex((acc) => acc.id === a.subject)
    const indexB = accounts.findIndex((acc) => acc.id === b.subject)
    // items not found in accounts list go to end
    if (indexA === -1 && indexB === -1) return 0
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })

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

  return (
    <SidebarSection title="Joined Spaces">
      {sortedContacts.length ? (
        sortedContacts.map((contact) => {
          const id = hmId(contact.subject)
          // Get account from the backend's account list (has metadata)
          const account = accounts.find((acc) => acc.id === contact.subject)
          const accountMeta = accountsMetadata?.[contact.subject]
          // Get metadata from fetched space resource (most reliable source)
          const spaceResource = spaceResources.find((r) => r.data?.id?.uid === contact.subject)
          const spaceMeta = spaceResource?.data?.type === 'document' ? spaceResource.data.document?.metadata : undefined

          // Build metadata: prefer contact name, then space resource, then account metadata
          const name = contact.name || spaceMeta?.name || accountMeta?.metadata?.name || account?.metadata?.name
          const icon = spaceMeta?.icon || accountMeta?.metadata?.icon || account?.metadata?.icon
          const metadata: HMMetadata = {name, icon}

          // Skip if no name and still loading, except for the pre-account default space.
          if (!name && spaceResource?.isLoading && selectedAccountId) return null
          if (!name && selectedAccountId) return null

          // Get activity data
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
            <SidebarMenuItem key={id.id}>
              <JoinedSpaceListItem
                id={id}
                contact={contact}
                metadata={metadata}
                active={isSpaceDocumentsActiveRoute(route, id)}
                isUnread={isUnread}
                activitySummary={activitySummary}
                latestComment={latestComment}
                accountsMetadata={accountsMetadata}
                canLeave={!!selectedAccountId}
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

/** Sidebar item for a joined space with leave functionality. */
function JoinedSpaceListItem({
  id,
  contact,
  metadata,
  active,
  isUnread,
  activitySummary,
  latestComment,
  accountsMetadata,
  canLeave = true,
}: {
  id: UnpackedHypermediaId
  contact: HMContactRecord
  metadata: HMMetadata
  active: boolean
  isUnread: boolean
  activitySummary?: HMActivitySummary
  latestComment?: HMComment
  accountsMetadata?: HMAccountsMetadata
  canLeave?: boolean
}) {
  const linkProps = useRouteLink({key: 'document', id})
  const navigate = useNavigate()
  const {leaveSpace, isPending} = useLeaveSpace({spaceUid: contact.subject})
  return (
    <>
      <SidebarMenuButton
        isActive={active}
        className={cn(
          'min-h-10 items-start pr-8',
          active &&
            'data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:hover:bg-accent/90 data-[active=true]:hover:text-accent-foreground',
        )}
        onClick={linkProps.onClick}
      >
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
      <OptionsDropdown
        side="right"
        align="start"
        button={
          <SidebarMenuAction aria-label="Joined space options" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-4" />
          </SidebarMenuAction>
        }
        menuItems={[
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
                  onClick: () => leaveSpace(),
                },
              ]
            : []),
        ]}
      />
    </>
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

function MySpaceSection({selectedAccountId}: {selectedAccountId?: string}) {
  const spaceId = selectedAccountId ? hmId(selectedAccountId) : undefined
  const resource = useResource(spaceId)
  const imageUrl = useImageUrl()
  const navigate = useNavigate()
  const route = useNavRoute()
  const active = spaceId ? isSpaceDocumentsActiveRoute(route, spaceId) : false
  const createSpaceDialog = useCreateSpaceDialog()

  if (!selectedAccountId) return null

  // Account has a home document — show the existing space section
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
                key: 'space-settings',
                label: 'Space settings',
                icon: <Settings className="size-4" />,
                onClick: () => navigate({key: 'space-settings', id: hmId(selectedAccountId)}),
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
