import {useBookmarks, useRemoveBookmark} from '@/models/bookmarks'
import {useComments} from '@/models/comments'
import {useContactList} from '@/models/contacts'
import {useSubscribedDocuments} from '@/models/library'
import {grpcClient} from '@/grpc-client'
import {useSelectedAccountId} from '@/selected-account'
import {getOrCreateSiteHome} from '@/utils/create-site'
import {useNavigate} from '@/utils/useNavigate'
import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMComment,
  HMContactRecord,
  HMMetadata,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {defaultJoinedSiteUid, useRouteLink} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hasProfileSubscription, useFollowProfile, useLeaveSite} from '@shm/shared/models/join-site'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {createDocumentNavRoute, type ProfileTab} from '@shm/shared/routes'
import {bookmarkUrlFromRoute, hmId, ViewTerm, viewTermToRouteKey} from '@shm/shared/utils/entity-id-url'
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
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  History,
  LayoutList,
  Library,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Quote,
  Users,
} from 'lucide-react'
import React, {memo} from 'react'
import {BookmarkOptionsMenu} from './bookmark-options-menu'
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
            {/* Enable Agents in the sidebar once the feature is ready for general use.
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
        <BookmarksSection />
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

function BookmarksSection() {
  const bookmarks = useBookmarks()
  const removeBookmark = useRemoveBookmark()
  const contacts = useSelectedAccountContacts()
  const bookmarkIds = bookmarks.map((b) => b.id)
  const bookmarkEntities = useResources(bookmarkIds)
  const route = useNavRoute()
  const currentBookmarkUrl = bookmarkUrlFromRoute(route)
  if (!bookmarkEntities.length) return null
  return (
    <SidebarSection title="Bookmarks">
      {bookmarks.map((bookmarkItem, i) => {
        const entity = bookmarkEntities[i]
        const deletingBookmark = removeBookmark.isLoading && removeBookmark.variables === bookmarkItem.url
        const deleteBookmark = () => removeBookmark.mutate(bookmarkItem.url)
        if (!entity?.data) {
          if (entity?.isLoading) return null
          return (
            <SidebarMenuItem key={bookmarkItem.url}>
              <ErrorListItem
                id={bookmarkItem.id}
                active={currentBookmarkUrl === bookmarkItem.url}
                onDeleteBookmark={deleteBookmark}
                deletingBookmark={deletingBookmark}
              />
            </SidebarMenuItem>
          )
        }
        if (entity.data.type === 'error') {
          return (
            <SidebarMenuItem key={bookmarkItem.url}>
              <ErrorListItem
                id={entity.data.id}
                active={currentBookmarkUrl === bookmarkItem.url}
                onDeleteBookmark={deleteBookmark}
                deletingBookmark={deletingBookmark}
              />
            </SidebarMenuItem>
          )
        }
        if (entity.data.type !== 'document') {
          return (
            <SidebarMenuItem key={bookmarkItem.url}>
              <ErrorListItem
                id={bookmarkItem.id}
                active={currentBookmarkUrl === bookmarkItem.url}
                onDeleteBookmark={deleteBookmark}
                deletingBookmark={deletingBookmark}
              />
            </SidebarMenuItem>
          )
        }
        const {id, document} = entity.data
        const metadata = id.path?.length
          ? document?.metadata
          : getContactMetadata(id.uid, document?.metadata, contacts.data)
        if (!metadata) return null
        return (
          <SidebarMenuItem key={bookmarkItem.url}>
            <BookmarkListItem
              id={id}
              metadata={metadata}
              active={currentBookmarkUrl === bookmarkItem.url}
              visibility={document?.visibility}
              bookmarkKey={bookmarkItem.key}
              viewTerm={bookmarkItem.viewTerm}
              onDeleteBookmark={deleteBookmark}
              deletingBookmark={deletingBookmark}
            />
          </SidebarMenuItem>
        )
      })}
    </SidebarSection>
  )
}

function ErrorListItem({
  id,
  active,
  onDeleteBookmark,
  deletingBookmark,
}: {
  id: UnpackedHypermediaId
  active: boolean
  onDeleteBookmark: () => void
  deletingBookmark?: boolean
}) {
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <>
      <SmallListItem
        key={id.id}
        docId={id.id}
        active={active}
        title="Error"
        textClass="text-destructive"
        icon={<AlertCircle className="text-destructive size-5" />}
        className="pr-8"
        {...linkProps}
      />
      <BookmarkOptionsMenu onDeleteBookmark={onDeleteBookmark} disabled={deletingBookmark} />
    </>
  )
}

const VIEW_TERM_ICONS: Record<string, React.ElementType> = {
  ':comments': MessageSquare,
  ':activity': Quote,
  ':collaborators': Users,
  ':directory': Folder,
  ':feed': History,
}

function profileTabFromViewTerm(viewTerm: ViewTerm | null): ProfileTab {
  switch (viewTerm) {
    case ':membership':
      return 'membership'
    case ':followers':
      return 'followers'
    case ':following':
      return 'following'
    default:
      return 'profile'
  }
}

function BookmarkListItem({
  id,
  metadata,
  active,
  visibility,
  bookmarkKey,
  viewTerm,
  onDeleteBookmark,
  deletingBookmark,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
  active: boolean
  visibility?: HMResourceVisibility
  bookmarkKey: 'document' | 'profile'
  viewTerm: ViewTerm | null
  onDeleteBookmark: () => void
  deletingBookmark?: boolean
}) {
  const navRoute =
    bookmarkKey === 'profile'
      ? {key: 'profile' as const, id, tab: profileTabFromViewTerm(viewTerm)}
      : viewTerm
      ? createDocumentNavRoute(id, viewTermToRouteKey(viewTerm))
      : {key: 'document' as const, id}
  const linkProps = useRouteLink(navRoute)
  const ViewTermIcon = viewTerm ? VIEW_TERM_ICONS[viewTerm] : null
  return (
    <>
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
        className="pr-8"
        {...linkProps}
      />
      <BookmarkOptionsMenu onDeleteBookmark={onDeleteBookmark} disabled={deletingBookmark} />
    </>
  )
}

function SubscriptionsSection() {
  const selectedAccountId = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  // accountList is already sorted by activity from backend (default sort)
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

  // Sort by activity using the backend's account order (already sorted by activity desc)
  const accounts = accountList.data?.accounts || []
  const sortedContacts = [...(siteSubscribed || [])].sort((a, b) => {
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
    <SidebarSection title="Joined Sites">
      {sortedContacts.length ? (
        sortedContacts.map((contact) => {
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
              <JoinedSiteListItem
                id={id}
                contact={contact}
                metadata={metadata}
                active={isSiteDocumentsActiveRoute(route, id)}
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
            Click "Join" on a site to get started.
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
  const {leaveSite, isPending} = useLeaveSite({siteUid: contact.subject})
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
          <SidebarMenuAction aria-label="Joined site options" onClick={(e) => e.stopPropagation()}>
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
                  label: 'Leave Site',
                  icon: <CircleOff className="size-4" />,
                  variant: 'destructive' as const,
                  disabled: isPending,
                  onClick: () => leaveSite(),
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

function MySiteSection({selectedAccountId}: {selectedAccountId?: string}) {
  const siteId = selectedAccountId ? hmId(selectedAccountId) : undefined
  const resource = useResource(siteId)
  const imageUrl = useImageUrl()
  const navigate = useNavigate()
  const route = useNavRoute()
  const active = siteId ? isSiteDocumentsActiveRoute(route, siteId) : false
  const [isCreatingSite, setIsCreatingSite] = React.useState(false)

  if (!selectedAccountId) return null

  // Account has a home document — show the existing site section
  if (resource.data?.type === 'document' && resource.data.document) {
    const {document} = resource.data
    return (
      <SidebarSection title="My Site">
        <div
          className={cn(
            'border-border hover:bg-sidebar-accent my-2 flex cursor-pointer items-center gap-2 rounded-lg border p-2',
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
      </SidebarSection>
    )
  }

  // Account has no home document — show a CTA to create one.
  // Don't show CTA while still loading/discovering.
  if (resource.isInitialLoading || resource.isDiscovering) return null

  return (
    <SidebarSection title="My Site">
      <Tooltip content="Create your site to publish documents and share your profile.">
        <Button
          className="w-full"
          variant="default"
          disabled={isCreatingSite}
          onClick={async () => {
            setIsCreatingSite(true)
            try {
              const homeId = await getOrCreateSiteHome(selectedAccountId)
              navigate({
                key: 'document',
                id: homeId,
              })
            } catch (error) {
              console.error('Failed to verify site before creating draft:', error)
              toast.error('Could not verify whether your site already exists. Please try again.')
            } finally {
              setIsCreatingSite(false)
            }
          }}
        >
          {isCreatingSite ? 'Checking for existing site…' : 'Create my Site'}
        </Button>
      </Tooltip>
    </SidebarSection>
  )
}
