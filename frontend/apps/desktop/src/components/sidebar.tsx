import {useSelectedAccountContacts} from '@/models/contacts'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useFavorites} from '@/models/favorites'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {getContactMetadata} from '@shm/shared/content'
import {useResources} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {SmallListItem} from '@shm/ui/list-item'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {
  ChevronDown,
  ChevronRight,
  Contact,
  File,
  FilePlus2,
  Home,
  Library,
} from 'lucide-react'
import React, {memo} from 'react'
import {GenericSidebarContainer} from './sidebar-base'
import {SidebarFooter} from './sidebar-footer'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()

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
      <FavoritesSection />
    </GenericSidebarContainer>
  )
}

function CreateDocumentButton() {
  const createDraft = useCreateDraft()
  const myAccountIds = useMyAccountIds()
  if (!myAccountIds.data?.length) return null
  return (
    <Tooltip content="Create Document" side="bottom">
      <Button
        variant="default"
        onClick={() => createDraft()}
        className="mb-5 w-full justify-center"
      >
        <FilePlus2 color="currentColor" size={16} />{' '}
        <span className="truncate">Create Document</span>
      </Button>
    </Tooltip>
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
          <SmallListItem
            key={id.id}
            docId={id.id}
            title={metadata?.name || 'Untitled'}
            icon={
              <HMIcon
                id={id}
                name={metadata?.name}
                icon={metadata?.icon}
                size={20}
              />
            }
            active={route.key === 'document' && route.id.id === id.id}
            onClick={() => {
              navigate({key: 'document', id})
            }}
          />
        )
      })}
    </SidebarSection>
  )
}
