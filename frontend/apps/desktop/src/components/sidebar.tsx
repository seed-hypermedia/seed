import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useFavorites} from '@/models/favorites'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {getDocumentTitle} from '@shm/shared/content'
import {useEntities} from '@shm/shared/models/entity'
import {hmId, latestId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {
  ChevronDown,
  ChevronRight,
  Contact,
  File,
  FilePlus2,
  Library,
  Plus,
  UserPlus2,
} from '@shm/ui/icons'
import {SmallListItem} from '@shm/ui/list-item'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import React, {memo} from 'react'
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
    <Button
      variant="brand"
      onClick={() => createDraft()}
      className="mb-3 w-full"
    >
      <FilePlus2 color="white" />
      Create Document
    </Button>
  )
}

function SidebarSection({
  title,
  children,
  accessory,
  className,
}: {
  title: string
  children: React.ReactNode
  accessory?: React.ReactNode
  className?: string
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  let Icon = collapsed ? ChevronRight : ChevronDown
  return (
    <div className="flex flex-col mt-4 relative">
      <div
        className={cn(
          'flex items-center justify-between px-2',
          accessory && 'pr-0',
        )}
      >
        <div
          className="flex gap-1 justify-center items-center cursor-pointer group"
          onClick={() => {
            setCollapsed(!collapsed)
          }}
        >
          <span className="font-bold text-xs text-gray-600 dark:text-gray-400 group-hover:text-gray-800 dark:group-hover:text-gray-200 capitalize select-none">
            {title}
          </span>
          <div className="flex items-center justify-center w-4 h-5">
            <Icon size={12} color="$color11" />
          </div>
        </div>
        {accessory ? <div className="flex">{accessory}</div> : null}
      </div>
      {collapsed ? null : children}
    </div>
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
            docId={id.id}
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
  return (
    <SidebarSection
      title="Accounts"
      accessory={
        hasAccounts ? (
          <div className=" absolute top-0 right-0">
            <Tooltip content="Add Account">
              <Button
                variant="ghost"
                className="p-0"
                size="xs"
                onClick={() => dispatchOnboardingDialog(true)}
              >
                <Plus style={{width: 12, height: 12}} />
              </Button>
            </Tooltip>
          </div>
        ) : undefined
      }
    >
      {accounts.map((account) => {
        if (!account.data) return null
        const {id, document} = account.data
        return (
          <SmallListItem
            key={id.uid}
            docId={id.id}
            title={getDocumentTitle(document) || id.uid}
            icon={<HMIcon id={id} metadata={document?.metadata} size={20} />}
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
