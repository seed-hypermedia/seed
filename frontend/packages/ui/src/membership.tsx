import { HMContactRecord } from '@seed-hypermedia/client/hm-types'
import { hmId, useRouteLink } from '@shm/shared'
import { useContactListOfAccount } from '@shm/shared/models/contacts'
import { useAccount } from '@shm/shared/models/entity'
import { HMIcon } from './hm-icon'
import { Spinner } from './spinner'
import { SizableText } from './text'

/** Shows sites/accounts that this account has membership in (all contacts). */
export function MembershipContent({siteUid, accountUid}: {siteUid: string; accountUid: string}) {
  const contacts = useContactListOfAccount(accountUid)
  const siteSubscribed = contacts.data?.filter((contact) => contact.subscribe?.site)
  // Deduplicate by subject (account being subscribed to)
  const uniqueSiteSubscribed = siteSubscribed?.filter(
    (contact, index, arr) => arr.findIndex((c) => c.subject === contact.subject) === index,
  )
  if (contacts.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }
  if (!uniqueSiteSubscribed?.length) {
    return (
      <div className="py-8 text-center">
        <SizableText color="muted">No site memberships yet</SizableText>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {uniqueSiteSubscribed?.map((contact) => {
        return <MembershipItem key={contact.subject} contact={contact} siteUid={siteUid} />
      })}
    </div>
  )
}

/** Single item showing a site/account membership. */
function MembershipItem({contact, siteUid: _siteUid}: {contact: HMContactRecord; siteUid: string}) {
  const subject = useAccount(contact.subject)
  const linkProps = useRouteLink({
    key: 'document',
    id: hmId(contact.subject),
  })

  const name = contact.name || subject.data?.metadata?.name
  const icon = subject.data?.metadata?.icon

  return (
    <a {...linkProps} className="hover:bg-muted flex items-center gap-3 rounded-lg p-3 transition-colors">
      <HMIcon id={hmId(contact.subject)} size={40} icon={icon} name={name} />
      <div className="min-w-0 flex-1">
        <SizableText weight="medium" className="truncate">
          {name || 'Untitled'}
        </SizableText>
      </div>
    </a>
  )
}
