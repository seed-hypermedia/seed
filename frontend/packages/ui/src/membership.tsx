import {HMContactRecord} from '@seed-hypermedia/client/hm-types'
import {useContactListOfAccount} from '@shm/shared/models/contacts'
import {useAccount} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {HMIcon} from './hm-icon'
import {Spinner} from './spinner'
import {SizableText} from './text'

export function MembershipContent({accountUid}: {accountUid: string}) {
  const contacts = useContactListOfAccount(accountUid)
  if (contacts.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }
  if (!contacts.data?.length) {
    return (
      <div className="py-8 text-center">
        <SizableText color="muted">No contacts yet</SizableText>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {contacts.data.map((contact) => {
        return <MembershipItem key={contact.id} contact={contact} />
      })}
    </div>
  )
}

function MembershipItem({contact}: {contact: HMContactRecord}) {
  const subject = useAccount(contact.subject)

  return (
    <div className="flex items-center gap-2">
      <HMIcon id={hmId(contact.subject)} size={40} name={contact.name} />
      <SizableText weight="medium" className="truncate">
        {contact.name || subject.data?.metadata?.name}
      </SizableText>
    </div>
  )
}
