import { HMMetadataPayload } from '@seed-hypermedia/client/hm-types'
import { hmId, hostnameStripProtocol, ProfileTab, useFollowProfile, useRouteLink } from '@shm/shared'
import { useAccount, useResource } from '@shm/shared/models/entity'
import { ReactNode } from 'react'
import { Button } from './button'
import { ScrollArea } from './components/scroll-area'
import { Feed } from './feed'
import { FollowButton } from './follow-button'
import { FollowersContent } from './followers'
import { FollowingContent } from './following'
import { HMIcon } from './hm-icon'
import { Pencil } from './icons'
import { MembershipContent } from './membership'
import { PageLayout } from './page-layout'
import { PageTabItem, PageTabs } from './page-tabs'

export type SiteAccountTab = 'profile' | 'membership' | 'followers' | 'following'

const SITE_ACCOUNT_TABS: {label: string; value: SiteAccountTab}[] = [
  {label: 'Activity', value: 'profile'},
  {label: 'Site Membership', value: 'membership'},
  {label: 'Followers', value: 'followers'},
  {label: 'Following', value: 'following'},
]

export function AccountPage({
  siteUid,
  accountUid,
  tab,
  onEditProfile,
  headerButtons,
  onFollowClick,
}: {
  siteUid?: string | null
  accountUid: string
  tab: ProfileTab
  /** Callback to open edit profile dialog (only shown for own account) */
  onEditProfile?: () => void
  /** Additional header buttons (e.g., logout, link keys) - only shown for own account */
  headerButtons?: ReactNode
  /** Override follow button click (web: saves intent + opens signup for unauthenticated users) */
  onFollowClick?: () => void
}) {
  let ActiveTabContent = ProfileContent
  if (tab === 'membership') {
    ActiveTabContent = MembershipContent
  } else if (tab === 'followers') {
    ActiveTabContent = FollowersContent
  } else if (tab === 'following') {
    ActiveTabContent = FollowingContent
  }
  return (
    <ScrollArea className="flex-1">
      <PageLayout contentMaxWidth={720}>
        <div className="space-y-6 py-8">
          <div className="space-y-4">
            <ProfileHeader
              siteUid={siteUid}
              accountUid={accountUid}
              onEditProfile={onEditProfile}
              headerButtons={headerButtons}
              onFollowClick={onFollowClick}
            />
            <AccountPageTabs siteUid={siteUid} accountUid={accountUid} tab={tab} />
          </div>
          <ActiveTabContent siteUid={siteUid} accountUid={accountUid} />
        </div>
      </PageLayout>
    </ScrollArea>
  )
}

function ProfileHeader({
  siteUid: _siteUid,
  accountUid,
  onEditProfile,
  headerButtons,
  onFollowClick,
}: {
  siteUid?: string | null
  accountUid: string
  onEditProfile?: () => void
  headerButtons?: ReactNode
  onFollowClick?: () => void
}) {
  const account = useAccount(accountUid)
  const {isFollowing, isPending, isOwnAccount, followProfile, unfollowProfile} = useFollowProfile({
    profileUid: accountUid,
  })

  const handleFollowClick = onFollowClick ?? followProfile

  return (
    <div className="flex items-center gap-4">
      <HMIcon id={hmId(accountUid)} size={64} icon={account.data?.metadata?.icon} name={account.data?.metadata?.name} />
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="truncate text-2xl font-bold">{account.data?.metadata?.name || accountUid}</h1>
        <SiteLink account={account.data} />
      </div>
      <div className="flex items-center gap-2">
        {isOwnAccount && onEditProfile && (
          <Button variant="outline" onClick={onEditProfile}>
            <Pencil className="size-4" />
            Edit
          </Button>
        )}
        {isOwnAccount && headerButtons}
        {!isOwnAccount && (
          <FollowButton
            onClick={isFollowing ? unfollowProfile : handleFollowClick}
            disabled={isPending}
            isFollowing={isFollowing}
          />
        )}
      </div>
    </div>
  )
}

function SiteLink({account}: {account?: HMMetadataPayload | null}) {
  const homeDocument = useResource(hmId(account?.id.uid), {subscribed: true})
  const homeDocData = homeDocument.data?.type === 'document' ? homeDocument.data.document : null
  const hasSite = !!account?.metadata?.siteUrl || !!homeDocData?.content?.length
  const linkProps = useRouteLink({
    key: 'document',
    id: hmId(account?.id.uid),
  })
  if (!hasSite) return null
  return <a className="text-blue-500" {...linkProps}>{ account?.metadata?.siteUrl ? hostnameStripProtocol(account.metadata.siteUrl) : 'Open Site'}</a>
}

function ProfileContent({siteUid: _siteUid, accountUid}: {siteUid?: string | null; accountUid: string}) {
  return (
    <div className="flex flex-col gap-4">
      <Feed filterAuthors={[accountUid]} filterResource={undefined} />
    </div>
  )
}

function AccountPageTabs({
  siteUid,
  accountUid,
  tab,
}: {
  siteUid?: string | null
  accountUid: string
  tab: SiteAccountTab
}) {
  const tabs: PageTabItem[] = SITE_ACCOUNT_TABS.map((t) => ({
    key: t.value,
    label: t.label,
    route: siteUid
      ? {
          key: 'site-profile',
          id: hmId(siteUid),
          accountUid: accountUid !== siteUid ? accountUid : undefined,
          tab: t.value,
        }
      : {
          key: 'profile',
          id: hmId(accountUid),
          tab: t.value,
        },
  }))

  return <PageTabs tabs={tabs} activeTab={tab} />
}
