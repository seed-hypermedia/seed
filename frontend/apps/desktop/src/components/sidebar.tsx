import {useBookmarks} from '@/models/bookmarks'
import {useComments} from '@/models/comments'
import {useContactList} from '@/models/contacts'
import {useSubscribedDocuments} from '@/models/library'
import {useSelectedAccountId} from '@/selected-account'
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
import {useRouteLink} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {useSelectedAccountContacts} from '@shm/shared/models/contacts'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hasProfileSubscription, useFollowProfile, useLeaveSite} from '@shm/shared/models/join-site'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {LibraryEntryUpdateSummary} from '@shm/ui/activity'
import {UIAvatar} from '@shm/ui/avatar'
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
import {cn} from '@shm/ui/utils'
import {AlertCircle, ChevronDown, ChevronRight, File, Library, Lock, MoreHorizontal} from 'lucide-react'
import React, {memo} from 'react'
import {CreateDocumentButton} from './create-doc-button'
import {GenericSidebarContainer} from './sidebar-base'
import {SidebarFooter as AppSidebarFooter} from './sidebar-footer'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  return (
    <GenericSidebarContainer
      footer={({isVisible}) => (
        <SidebarFooterLayout className="gap-0 p-0">
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
          </SidebarMenu>
          <AppSidebarFooter isSidebarVisible={isVisible} />
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
  const contacts = useSelectedAccountContacts()
  const bookmarkEntities = useResources(bookmarks || [])
  const route = useNavRoute()
  if (!bookmarkEntities.length) return null
  return (
    <SidebarSection title="Bookmarks">
      {bookmarkEntities?.map((bookmark) => {
        if (!bookmark.data) return null
        if (bookmark.data.type === 'error') {
          return (
            <SidebarMenuItem key={bookmark.data.id.id}>
              <ErrorListItem
                id={bookmark.data.id}
                active={route.key === 'document' && route.id.id === bookmark.data.id.id}
              />
            </SidebarMenuItem>
          )
        }
        if (bookmark.data.type !== 'document') return null
        const {id, document} = bookmark.data
        const metadata = id.path?.length
          ? document?.metadata
          : getContactMetadata(id.uid, document?.metadata, contacts.data)
        if (!metadata) return null
        return (
          <SidebarMenuItem key={id.id}>
            <BookmarkListItem
              id={id}
              metadata={metadata}
              active={route.key === 'document' && route.id.id === id.id}
              visibility={document?.visibility}
            />
          </SidebarMenuItem>
        )
      })}
    </SidebarSection>
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

function BookmarkListItem({
  id,
  metadata,
  active,
  visibility,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
  active: boolean
  visibility?: HMResourceVisibility
}) {
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <SmallListItem
      key={id.id}
      docId={id.id}
      active={active}
      title={metadata?.name || 'Untitled'}
      icon={<HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} />}
      accessory={visibility === 'PRIVATE' ? <Lock size={12} /> : null}
      {...linkProps}
    />
  )
}

function SubscriptionsSection() {
  const selectedAccountId = useSelectedAccountId()
  const contacts = useSelectedAccountContacts()
  // accountList is already sorted by activity from backend (default sort)
  const accountList = useContactList()

  // Filter contacts with site subscription, excluding own account
  const siteSubscribed = contacts.data?.filter(
    (contact) => contact.subscribe?.site && contact.subject !== selectedAccountId,
  )

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

  if (!sortedContacts.length) return null

  return (
    <SidebarSection title="Joined Sites">
      {sortedContacts.map((contact) => {
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

        // Skip if no name and still loading
        if (!name && siteResource?.isLoading) return null
        if (!name) return null

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
              active={route.key === 'document' && route.id.id === id.id}
              isUnread={isUnread}
              activitySummary={activitySummary}
              latestComment={latestComment}
              accountsMetadata={accountsMetadata}
            />
          </SidebarMenuItem>
        )
      })}
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

  // Filter contacts with profile subscription, excluding own account
  const profileSubscribed = contacts.data?.filter(
    (contact) => hasProfileSubscription(contact) && contact.subject !== selectedAccountId,
  )

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
      <SidebarMenuButton isActive={active} className="min-h-10 items-start pr-8" onClick={linkProps.onClick}>
        <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} className="mt-0.5 shrink-0 self-center" />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <span className="truncate text-left text-sm select-none">{metadata?.name || 'Untitled'}</span>
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

  if (resource.data?.type !== 'document' || !resource.data.document) return null

  const {document} = resource.data
  return (
    <SidebarSection title="My Site">
      <div
        className="border-border hover:bg-sidebar-accent my-2 flex cursor-pointer items-center gap-2 rounded-lg border p-2"
        onClick={
          selectedAccountId
            ? () => {
                navigate({key: 'document', id: hmId(selectedAccountId!)})
              }
            : undefined
        }
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
