import {useComments} from '@/models/comments'
import {useContactList, useSelectedAccountContacts} from '@/models/contacts'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useFavorites} from '@/models/favorites'
import {useSubscribedDocuments} from '@/models/library'
import {useListSubscriptions} from '@/models/subscription'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {useRouteLink} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {
  HMAccountsMetadata,
  HMActivitySummary,
  HMComment,
  HMMetadata,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
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
import {useImageUrl} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {HoverCard, HoverCardContent, HoverCardTrigger} from '@shm/ui/hover-card'
import {SmallListItem} from '@shm/ui/list-item'
import {SizableText} from '@shm/ui/text'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Contact,
  File,
  FilePlus2,
  Info,
  Library,
  Lock,
} from 'lucide-react'
import React, {memo} from 'react'
import {usePublishSite} from './publish-site'
import {GenericSidebarContainer} from './sidebar-base'
import {SidebarFooter} from './sidebar-footer'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  return (
    <GenericSidebarContainer
      footer={({isVisible}) => (
        <div>
          <div className="border-border flex w-full flex-col gap-2 border-t py-4">
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
            <SmallListItem
              active={route.key == 'contacts'}
              onClick={() => {
                navigate({key: 'contacts'})
              }}
              icon={<Contact className="size-4" />}
              title="Contacts"
              bold
            />
            <SmallListItem
              active={route.key == 'drafts'}
              onClick={() => {
                navigate({key: 'drafts'})
              }}
              icon={<File className="size-4" />}
              title="Drafts"
              bold
            />
          </div>
          <SidebarFooter isSidebarVisible={isVisible} />
        </div>
      )}
    >
      <CreateDocumentButton />
      <MySiteSection selectedAccountId={selectedAccountId ?? undefined} />

      <SubscriptionsSection />
      <FavoritesSection />
    </GenericSidebarContainer>
  )
}

function CreateDocumentButton() {
  const createDraft = useCreateDraft()
  const createPrivateDraft = useCreateDraft({visibility: 'PRIVATE'})
  const myAccountIds = useMyAccountIds()
  const selectedAccount = useSelectedAccount()
  const publishSite = usePublishSite()

  const siteUrl =
    selectedAccount?.type === 'document'
      ? selectedAccount.document?.metadata?.siteUrl
      : undefined
  const hasSiteUrl = Boolean(siteUrl)

  if (!myAccountIds.data?.length) return null
  return (
    <>
      {publishSite.content}
      <DropdownMenu>
        <DropdownMenuTrigger asChild className="mb-5 w-full">
          <Button variant="default" className="w-full justify-center">
            <FilePlus2 color="currentColor" size={16} />{' '}
            <span className="truncate">Create Document</span>
            <ChevronDown size={14} className="ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => createDraft()}>
            <FilePlus2 size={16} />
            Public Document
          </DropdownMenuItem>
          {hasSiteUrl ? (
            <DropdownMenuItem onClick={() => createPrivateDraft()}>
              <Lock size={16} />
              Private Document
            </DropdownMenuItem>
          ) : (
            <HoverCard openDelay={100}>
              <HoverCardTrigger asChild>
                <div>
                  <DropdownMenuItem
                    className="pointer-events-none opacity-50"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Lock size={16} />
                    Private Document
                    <Info size={14} className="text-muted-foreground ml-auto" />
                  </DropdownMenuItem>
                </div>
              </HoverCardTrigger>
              <HoverCardContent side="right" sideOffset={12} className="w-64">
                <div className="flex flex-col gap-3">
                  <SizableText size="sm" className="text-muted-foreground">
                    To create private documents, you need to configure your web
                    domain first.
                  </SizableText>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (selectedAccount?.id) {
                        publishSite.open({id: selectedAccount.id})
                      }
                    }}
                  >
                    Set Up Web Domain
                  </Button>
                </div>
              </HoverCardContent>
            </HoverCard>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <div
          className="group/header hover:bg-border flex w-full cursor-pointer items-center justify-center gap-1"
          onClick={() => {
            setCollapsed(!collapsed)
          }}
        >
          <div className="flex w-full items-center rounded-lg px-2">
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
          </div>
        </div>
        <div className="flex">{accessory}</div>
      </div>
      {collapsed ? null : <div className="flex flex-col gap-1">{children}</div>}
    </div>
  )
}

function FavoritesSection() {
  const favorites = useFavorites()
  const contacts = useSelectedAccountContacts()
  const favoriteEntities = useResources(favorites || [])
  const route = useNavRoute()
  if (!favoriteEntities.length) return null
  return (
    <SidebarSection title="Favorites">
      {favoriteEntities?.map((favorite) => {
        if (!favorite.data) return null
        if (favorite.data.type === 'error') {
          return (
            <ErrorListItem
              key={favorite.data.id.id}
              id={favorite.data.id}
              active={
                route.key === 'document' && route.id.id === favorite.data.id.id
              }
            />
          )
        }
        // @ts-expect-error TODO: fix this
        const {id, document} = favorite.data
        const metadata = id.path?.length
          ? document?.metadata
          : getContactMetadata(id.uid, document?.metadata, contacts.data)
        if (!metadata) return null
        return (
          <FavoriteListItem
            key={id.id}
            id={id}
            metadata={metadata}
            active={route.key === 'document' && route.id.id === id.id}
            visibility={document?.visibility}
          />
        )
      })}
    </SidebarSection>
  )
}

function ErrorListItem({
  id,
  active,
}: {
  id: UnpackedHypermediaId
  active: boolean
}) {
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

function FavoriteListItem({
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
      icon={
        <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} />
      }
      accessory={visibility === 'PRIVATE' ? <Lock size={12} /> : null}
      {...linkProps}
    />
  )
}

function SubscriptionsSection() {
  const subscriptions = useListSubscriptions()
  const selectedAccountId = useSelectedAccountId()
  // accountList is already sorted by activity from backend (default sort)
  const accountList = useContactList()
  // filter out subscription to current selected account (auto-subscribed on creation)
  const filteredSubs =
    subscriptions.data?.filter(
      (sub) => sub.id.uid !== selectedAccountId || sub.id.path?.length,
    ) || []
  // sort by activity using the backend's account order (already sorted by activity desc)
  const sortedSubs = [...filteredSubs].sort((a, b) => {
    const accounts = accountList.data?.accounts || []
    const indexA = accounts.findIndex((acc) => acc.id === a.id.uid)
    const indexB = accounts.findIndex((acc) => acc.id === b.id.uid)
    // items not found in accounts list go to end
    if (indexA === -1 && indexB === -1) return 0
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })

  const subscriptionIds = sortedSubs.map((sub) => sub.id)
  const subscriptionEntities = useResources(subscriptionIds)
  const contacts = useSelectedAccountContacts()
  const route = useNavRoute()

  const accountsMetadata = accountList.data?.accountsMetadata
  const accounts = accountList.data?.accounts || []

  // Fetch document-level activity for sub-document subscriptions
  const subscribedDocs = useSubscribedDocuments()

  // Fetch comments for account-level activity (for home subscriptions)
  const commentIds = accounts
    .map((acc) => acc.activitySummary?.latestCommentId)
    .filter((id): id is string => !!id && id.length > 0)
    .map((id) => hmId(id))
  const comments = useComments(commentIds)

  if (!sortedSubs.length) return null

  return (
    <SidebarSection title="Subscriptions">
      {sortedSubs.map((sub, index) => {
        const entity = subscriptionEntities[index]
        if (!entity?.data) return null
        if (entity.data.type === 'error') {
          return (
            <ErrorListItem
              key={entity.data.id.id}
              id={entity.data.id}
              active={
                route.key === 'document' && route.id.id === entity.data.id.id
              }
            />
          )
        }
        // @ts-expect-error TODO: fix this
        const {id, document} = entity.data
        const isHomeSubscription = !id.path?.length

        // Get document data from listDocuments (has proper metadata + activity)
        const docData = subscribedDocs.data?.get(id.id)

        // For home subscriptions, also check account-level data
        const account = isHomeSubscription
          ? accounts.find((acc) => acc.id === id.uid)
          : undefined

        // Skip subscriptions with no discoverable data (not synced yet)
        if (!docData && !account && !document?.metadata?.name) {
          return null
        }

        // Use best available metadata:
        // 1. For home subs: prefer contact name override, then docData, then entity
        // 2. For sub-docs: prefer docData, then entity
        const baseMetadata = docData?.metadata || document?.metadata
        const metadata = isHomeSubscription
          ? getContactMetadata(id.uid, baseMetadata, contacts.data)
          : baseMetadata
        if (!metadata) return null

        // Use account-level activity for home subs (if available), else document-level
        let activitySummary: HMActivitySummary | undefined
        let latestComment: HMComment | undefined

        if (isHomeSubscription && account?.activitySummary) {
          // Prefer account-level activity for home subscriptions
          activitySummary = account.activitySummary as HMActivitySummary
          latestComment = activitySummary?.latestCommentId
            ? comments.data?.find(
                (c) => c?.id === activitySummary?.latestCommentId,
              )
            : undefined
        } else {
          // Fall back to document-level activity
          activitySummary = docData?.activitySummary
          latestComment = docData?.latestComment ?? undefined
        }

        const isUnread = activitySummary?.isUnread ?? false
        return (
          <SubscriptionListItem
            key={id.id}
            id={id}
            metadata={metadata}
            active={route.key === 'document' && route.id.id === id.id}
            isUnread={isUnread}
            activitySummary={activitySummary}
            latestComment={latestComment}
            accountsMetadata={accountsMetadata}
          />
        )
      })}
    </SidebarSection>
  )
}

function SubscriptionListItem({
  id,
  metadata,
  active,
  isUnread,
  activitySummary,
  latestComment,
  accountsMetadata,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
  active: boolean
  isUnread: boolean
  activitySummary?: HMActivitySummary
  latestComment?: HMComment
  accountsMetadata?: HMAccountsMetadata
}) {
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <SmallListItem
      key={id.id}
      docId={id.id}
      active={active}
      icon={
        <HMIcon id={id} name={metadata?.name} icon={metadata?.icon} size={20} />
      }
      {...linkProps}
    >
      <div className="flex w-full flex-1 flex-col overflow-hidden">
        <SizableText
          size="sm"
          className="truncate text-left whitespace-nowrap select-none"
          weight={isUnread ? 'bold' : undefined}
        >
          {metadata?.name || 'Untitled'}
        </SizableText>
        {activitySummary && (
          <LibraryEntryUpdateSummary
            accountsMetadata={accountsMetadata}
            latestComment={latestComment}
            activitySummary={activitySummary}
          />
        )}
      </div>
    </SmallListItem>
  )
}

function MySiteSection({selectedAccountId}: {selectedAccountId?: string}) {
  const resource = useResource(
    selectedAccountId ? hmId(selectedAccountId) : undefined,
  )
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
        <span className="truncate text-sm font-bold select-none">
          {document.metadata.name}
        </span>
      </div>
    </SidebarSection>
  )
}
