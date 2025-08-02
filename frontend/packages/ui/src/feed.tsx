import {HMContactItem, HMResourceItem} from '@shm/shared/feed-types'
import {HMTimestamp} from '@shm/shared/hm-types'
import {formattedDateShort} from '@shm/shared/utils'
import {ContactToken} from './contact-token'
import {ResourceToken} from './resource-token'
import {SizableText} from './text'

export function EventRow({children}: {children: React.ReactNode}) {
  return <div className="flex gap-1 py-1">{children}</div>
}

export function EventContact({contact}: {contact?: HMContactItem}) {
  if (!contact) return null
  return <ContactToken id={contact.id} metadata={contact.metadata} />
}

export function EventResource({resource}: {resource: HMResourceItem}) {
  return <ResourceToken id={resource.id} metadata={resource.metadata} />
}

export function EventContacts({contacts}: {contacts: HMContactItem[]}) {
  return (
    <div>
      {contacts.map((contact) => {
        return <ContactToken id={contact.id} metadata={contact.metadata} />
      })}
    </div>
  )
}

export function EventDescriptionText({children}: {children: React.ReactNode}) {
  return <SizableText size="sm">{children}</SizableText>
}

export function EventTimestamp({time}: {time: HMTimestamp | undefined}) {
  if (!time) return null
  return (
    <SizableText size="sm" className="px-2 py-1 text-muted-foreground">
      {formattedDateShort(time)}
    </SizableText>
  )
}
