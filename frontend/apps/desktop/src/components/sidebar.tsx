import {useDeleteKey, useMyAccountIds} from '@/models/daemon'
import {useEntities} from '@/models/entities'
import {useExperiments} from '@/models/experiments'
import {useFavorites} from '@/models/favorites'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getDocumentTitle, hmId} from '@shm/shared'
import {
  Button,
  ChevronDown,
  Forward as ChevronRight,
  Contact,
  HMIcon,
  Library,
  Add as Plus,
  SizableText,
  SmallListItem,
  Tooltip,
  UserPlus2,
  XStack,
  YStack,
} from '@shm/ui'
import {Home} from '@tamagui/lucide-icons'
import React, {memo} from 'react'
import {openAddAccountWizard} from './create-account'
import {GenericSidebarContainer} from './sidebar-base'

export const AppSidebar = memo(MainAppSidebar)

export function MainAppSidebar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const experiments = useExperiments()
  return (
    <GenericSidebarContainer>
      {/* <SmallListItem
        active={route.key == 'home'}
        onPress={() => {
          navigate({key: 'home'})
        }}
        title="Home"
        bold
        icon={Home}
      /> */}
      {experiments.data?.newLibrary && (
        <SmallListItem
          active={route.key == 'library2'}
          onPress={() => {
            navigate({key: 'library2'})
          }}
          title="New Library"
          bold
          icon={Home}
        />
      )}
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
      <FavoritesSection />
      <AccountsSection />
      {/* <OutlineSection route={route} /> */}
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
    <YStack marginTop="$4" group="section">
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
            fontWeight="bold"
            fontSize="$1"
            color="$color11"
            $group-header-hover={{
              color: '$color12',
            }}
            textTransform="capitalize"
            userSelect="none"
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
  const favoriteEntities = useEntities(favorites || [])
  const navigate = useNavigate()
  const route = useNavRoute()
  if (!favoriteEntities.length) return null
  return (
    <SidebarSection title="Favorites">
      {favoriteEntities?.map((favorite) => {
        if (!favorite.data) return null
        const {id, document} = favorite.data
        return (
          <SmallListItem
            key={id.id}
            title={getDocumentTitle(document)}
            icon={<HMIcon id={id} metadata={document?.metadata} size={20} />}
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

  const hasAccounts = !!accountIds.data?.length
  const route = useNavRoute()
  const navigate = useNavigate()
  const deleteKey = useDeleteKey()
  return (
    <SidebarSection
      title="Accounts"
      accessory={
        hasAccounts ? (
          <Tooltip content="Add Account">
            <Button
              bg="$colorTransparent"
              chromeless
              size="$1"
              icon={Plus}
              onPress={openAddAccountWizard}
            />
          </Tooltip>
        ) : undefined
      }
    >
      {accounts.map((account) => {
        if (!account.data) return null
        const {id, document} = account.data
        return (
          <SmallListItem
            key={id.uid}
            title={getDocumentTitle(document) || id.uid}
            icon={<HMIcon id={id} metadata={document?.metadata} size={20} />}
            onPress={() => {
              navigate({key: 'document', id})
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
          onPress={openAddAccountWizard}
          icon={UserPlus2}
        />
      )}
    </SidebarSection>
  )
}
