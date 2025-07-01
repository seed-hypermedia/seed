import {useSelectedAccountContacts} from '@/models/contacts'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useFavorites} from '@/models/favorites'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getContactMetadata} from '@shm/shared/content'
import {useEntities} from '@shm/shared/models/entity'
import {hmId, latestId} from '@shm/shared/utils/entity-id-url'
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
  Library,
  Plus,
  UserPlus2,
} from 'lucide-react'
import React, {memo} from 'react'
import {XStack, YStack} from 'tamagui'
import {dispatchOnboardingDialog} from './onboarding'
import {GenericSidebarContainer} from './sidebar-base'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  return (
    <GenericSidebarContainer>
      <CreateDocumentButton />
      <SmallListItem
        active={route.key == 'library'}
        onPress={() => {
          navigate({key: 'library'})
        }}
        title="Library"
        bold
        icon={Library}
        rightHover={[]}
      />
      {/* <SmallListItem
        active={route.key == 'explore'}
        onPress={() => {
          navigate({key: 'explore'})
        }}
        title="Explore Content"
        bold
        icon={Sparkles}
        rightHover={[]}
      /> */}
      <SmallListItem
        active={route.key == 'contacts'}
        onPress={() => {
          navigate({key: 'contacts'})
        }}
        icon={Contact}
        title="Contacts"
        bold
      />
      <SmallListItem
        active={route.key == 'drafts'}
        onPress={() => {
          navigate({key: 'drafts'})
        }}
        icon={File}
        title="Drafts"
        bold
      />
      <FavoritesSection />
      <AccountsSection />
      {/* <OutlineSection route={route} /> */}
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
        className="mb-5 w-full justify-start"
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
    <YStack marginTop="$4">
      <XStack paddingHorizontal="$2" ai="center" jc="space-between">
        <XStack
          gap="$1"
          onPress={() => {
            setCollapsed(!collapsed)
          }}
          group="header"
          jc="center"
          ai="center"
        >
          <SizableText
            weight="bold"
            size="xs"
            color="muted"
            className="group-hover/header:text-foreground capitalize select-none"
          >
            {title}
          </SizableText>
          <XStack ai="center" jc="center" w={16} h={20}>
            <Icon size={12} color="$color11" />
          </XStack>
        </XStack>
        <XStack>{accessory}</XStack>
      </XStack>
      {collapsed ? null : children}
    </YStack>
  )
}

function FavoritesSection() {
  const favorites = useFavorites()
  const contacts = useSelectedAccountContacts()
  const favoriteEntities = useEntities(favorites || [])
  const navigate = useNavigate()
  const route = useNavRoute()
  if (!favoriteEntities.length) return null
  return (
    <SidebarSection title="Favorites">
      {favoriteEntities?.map((favorite) => {
        if (!favorite.data) return null
        const {id, document} = favorite.data
        const metadata = getContactMetadata(
          id.uid,
          document?.metadata,
          contacts.data,
        )
        return (
          <SmallListItem
            key={id.id}
            docId={id.id}
            title={metadata.name}
            icon={<HMIcon id={id} metadata={metadata} size={20} />}
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
  const contacts = useSelectedAccountContacts()
  const hasAccounts = !!accountIds.data?.length
  const route = useNavRoute()
  const navigate = useNavigate()
  return (
    <SidebarSection
      title="Accounts"
      accessory={
        hasAccounts ? (
          <Tooltip content="Add Account">
            <Button onClick={() => dispatchOnboardingDialog(true)} size="xs">
              <Plus />
            </Button>
          </Tooltip>
        ) : undefined
      }
    >
      {accounts.map((account) => {
        if (!account.data) return null
        const {id, document} = account.data
        const metadata = getContactMetadata(
          id.uid,
          document?.metadata,
          contacts.data,
        )
        return (
          <SmallListItem
            key={id.uid}
            docId={id.id}
            title={metadata.name}
            icon={<HMIcon id={id} metadata={metadata} size={20} />}
            onPress={() => {
              navigate({key: 'document', id: latestId(id)})
            }}
            active={
              route.key === 'document' &&
              route.id.uid === id.uid &&
              !route.id.path?.length
            }
          />
        )
      })}
      {hasAccounts ? null : (
        <SmallListItem
          key="add-account"
          title="Add Account"
          onPress={() => dispatchOnboardingDialog(true)}
          icon={UserPlus2}
        />
      )}
    </SidebarSection>
  )
}
