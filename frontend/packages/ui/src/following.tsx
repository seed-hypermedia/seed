import {hasProfileSubscription, hmId, useContactListOfAccount, useRouteLink} from '@shm/shared'
import {useAccountsMetadata} from '@shm/shared/models/entity'
import {useMemo} from 'react'
import {HMIcon} from './hm-icon'
import {Spinner} from './spinner'
import {SizableText} from './text'

/** Shows accounts that this account is following (contacts with profile subscription). */
export function FollowingContent({spaceUid, accountUid}: {spaceUid?: string | null; accountUid: string}) {
  const allContacts = useContactListOfAccount(accountUid)
  // Filter to only show contacts with profile subscription (explicit or implicit for legacy)
  // Deduplicate by subject (account being followed)
  const following = useMemo(() => {
    const filtered = allContacts.data?.filter((c) => hasProfileSubscription(c)) ?? []
    return filtered.filter((contact, index, arr) => arr.findIndex((c) => c.subject === contact.subject) === index)
  }, [allContacts.data])

  const followingUids = useMemo(() => {
    return following.map((c) => c.subject)
  }, [following])
  const followingAccounts = useAccountsMetadata(followingUids)

  if (allContacts.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (!following.length) {
    return (
      <div className="py-8 text-center">
        <SizableText color="muted">Not following anyone yet</SizableText>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {following.map((contact) => {
        const accountData = followingAccounts.data[contact.subject]
        return (
          <FollowingItem
            key={contact.id}
            accountUid={contact.subject}
            metadata={accountData?.metadata}
            spaceUid={spaceUid}
          />
        )
      })}
    </div>
  )
}

/** Single item showing an account being followed. */
function FollowingItem({
  accountUid,
  metadata,
  spaceUid,
}: {
  accountUid: string
  metadata?: {name?: string; icon?: string} | null
  spaceUid?: string | null
}) {
  const linkProps = useRouteLink(
    spaceUid
      ? {
          key: 'space-profile',
          id: hmId(spaceUid),
          accountUid: accountUid !== spaceUid ? accountUid : undefined,
          tab: 'profile',
        }
      : {
          key: 'profile',
          id: hmId(accountUid),
          tab: 'profile',
        },
  )

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
