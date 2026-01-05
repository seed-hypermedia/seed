import {useSelectedAccountContacts} from '@/models/contacts'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useFavorites} from '@/models/favorites'
import {useListSubscriptions} from '@/models/subscription'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {useRouteLink} from '@shm/shared'
import {getContactMetadata} from '@shm/shared/content'
import {
  HMMetadata,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResources} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {useHighlighter} from '@shm/ui/highlight-context'
import {HMIcon} from '@shm/ui/hm-icon'
import {Subscribe, SubscribeSpace} from '@shm/ui/icons'
import {SmallListItem} from '@shm/ui/list-item'
import {SizableText} from '@shm/ui/text'
import {
  ChevronDown,
  ChevronRight,
  Contact,
  File,
  FilePlus2,
  Home,
  Library,
  Lock,
} from 'lucide-react'
import React, {memo} from 'react'
import {GenericSidebarContainer} from './sidebar-base'
import {SidebarFooter} from './sidebar-footer'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  const highlighter = useHighlighter()
  return (
    <GenericSidebarContainer
      footer={({isVisible}) => <SidebarFooter isSidebarVisible={isVisible} />}
    >
      <CreateDocumentButton />
      <SmallListItem
        active={
          (route.key == 'document' || route.key == 'feed') &&
          route.id.uid == selectedAccountId &&
          route.id.path?.length == 0
        }
        onClick={() => {
          navigate({
            key: 'document',
            id: hmId(selectedAccountId),
          })
        }}
        bold
        title="Home"
        icon={<Home className="size-4" />}
        {...highlighter(hmId(selectedAccountId))}
      />
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
      <SubscriptionsSection />
      <FavoritesSection />
    </GenericSidebarContainer>
  )
}

function CreateDocumentButton() {
  const createDraft = useCreateDraft()
  const createPrivateDraft = useCreateDraft({visibility: 'PRIVATE'})
  const myAccountIds = useMyAccountIds()
  if (!myAccountIds.data?.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mb-5 w-full">
        <Button variant="default" className="w-full justify-center">
          <FilePlus2 color="currentColor" size={16} />{' '}
          <span className="truncate">Create Document</span>
          <ChevronDown size={14} className="ml-1 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => createDraft()}>
          <FilePlus2 size={16} />
          Public Document
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => createPrivateDraft()}>
          <Lock size={16} />
          Private Document
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <div className="mt-4 flex flex-col">
      <div className="flex items-center justify-between px-2">
        <div
          className="group/header flex cursor-pointer items-center justify-center gap-1"
          onClick={() => {
            setCollapsed(!collapsed)
          }}
        >
          <SizableText
            weight="bold"
            size="xs"
            color="muted"
            className="group-hover/header:text-foreground capitalize select-none"
          >
            {title}
          </SizableText>
          <div className="flex h-5 w-4 items-center justify-center">
            <Icon size={12} color="$color11" />
          </div>
        </div>
        <div className="flex">{accessory}</div>
      </div>
      {collapsed ? null : children}
    </div>
  )
}

function FavoritesSection() {
  const favorites = useFavorites()
  const contacts = useSelectedAccountContacts()
  const favoriteEntities = useResources(favorites || [])
  const navigate = useNavigate()
  const route = useNavRoute()
  if (!favoriteEntities.length) return null
  return (
    <SidebarSection title="Favorites">
      {favoriteEntities?.map((favorite) => {
        if (!favorite.data) return null
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
  const myAccountIds = useMyAccountIds()
  // filter out subscriptions to own accounts (auto-subscribed on creation)
  const filteredSubs =
    subscriptions.data?.filter(
      (sub) =>
        !myAccountIds.data?.includes(sub.id.uid) || sub.id.path?.length,
    ) || []
  const subscriptionIds = filteredSubs.map((sub) => sub.id)
  const subscriptionEntities = useResources(subscriptionIds)
  const contacts = useSelectedAccountContacts()
  const route = useNavRoute()

  if (!filteredSubs.length) return null

  return (
    <SidebarSection title="Subscriptions">
      {filteredSubs.map((sub, index) => {
        const entity = subscriptionEntities[index]
        if (!entity?.data) return null
        // @ts-expect-error TODO: fix this
        const {id, document} = entity.data
        const metadata = id.path?.length
          ? document?.metadata
          : getContactMetadata(id.uid, document?.metadata, contacts.data)
        if (!metadata) return null
        return (
          <SubscriptionListItem
            key={id.id}
            id={id}
            metadata={metadata}
            recursive={sub.recursive}
            active={route.key === 'document' && route.id.id === id.id}
          />
        )
      })}
    </SidebarSection>
  )
}

function SubscriptionListItem({
  id,
  metadata,
  recursive,
  active,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
  recursive: boolean
  active: boolean
}) {
  const linkProps = useRouteLink({key: 'document', id})
  const Icon = recursive ? SubscribeSpace : Subscribe
  return (
    <SmallListItem
      key={id.id}
      docId={id.id}
      active={active}
      title={metadata?.name || 'Untitled'}
      icon={
        // @ts-expect-error
        <Icon size={20} className="text-brand-5" />
      }
      {...linkProps}
    />
  )
}
