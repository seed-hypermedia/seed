import { hasProfileSubscription, hmId, useContactListOfSubject, useRouteLink } from '@shm/shared'
import { useAccountsMetadata } from '@shm/shared/models/entity'
import { useMemo } from 'react'
import { HMIcon } from './hm-icon'
import { Spinner } from './spinner'
import { SizableText } from './text'

/** Shows accounts that are following this account (contacts with profile subscription). */
export function FollowersContent({siteUid, accountUid}: {siteUid?: string | null; accountUid: string}) {
  const allContacts = useContactListOfSubject(accountUid)
  // Filter to only show contacts with profile subscription (explicit or implicit for legacy)
  // Deduplicate by account (the account that is following)
  const followers = useMemo(() => {
    const filtered = allContacts.data?.filter((c) => hasProfileSubscription(c)) ?? []
    return filtered.filter((contact, index, arr) => arr.findIndex((c) => c.account === contact.account) === index)
  }, [allContacts.data])

  const followerUids = useMemo(() => {
    return followers.map((c) => c.account)
  }, [followers])
  const followerAccounts = useAccountsMetadata(followerUids)

  if (allContacts.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (!followers.length) {
    return (
      <div className="py-8 text-center">
        <SizableText color="muted">No followers yet</SizableText>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {followers.map((contact) => {
        const accountData = followerAccounts.data[contact.account]
        return (
          <FollowerItem
            key={contact.id}
            accountUid={contact.account}
            metadata={accountData?.metadata}
            siteUid={siteUid}
          />
        )
      })}
    </div>
  )
}

/** Single item showing an account that is following. */
function FollowerItem({
  accountUid,
  metadata,
  siteUid,
}: {
  accountUid: string
  metadata?: {name?: string; icon?: string} | null
  siteUid?: string | null
}) {
  const linkProps = useRouteLink(siteUid ? {
    key: 'site-profile',
    id: hmId(siteUid),
    accountUid: accountUid !== siteUid ? accountUid : undefined,
    tab: 'profile',
  } : {
    key: 'profile',
    id: hmId(accountUid),
    tab: 'profile',
  })

  return (
    <a {...linkProps} className="hover:bg-muted flex items-center gap-3 rounded-lg p-3 transition-colors">
      <HMIcon id={hmId(accountUid)} size={40} icon={metadata?.icon} name={metadata?.name} />
      <div className="min-w-0 flex-1">
        <SizableText weight="medium" className="truncate">
          {metadata?.name || 'Untitled'}
        </SizableText>
      </div>
    </a>
  )
}
