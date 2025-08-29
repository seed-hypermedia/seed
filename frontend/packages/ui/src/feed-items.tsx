import {
  LoadedCapabilityEvent,
  LoadedCommentEvent,
  LoadedContactEvent,
  LoadedDocUpdateEvent,
  LoadedFeedEvent,
} from '@shm/shared/feed-types'
import {NavRoute} from '@shm/shared/routes'
import {Comment} from './comments'
import {
  EventContact,
  EventContacts,
  EventDescriptionText,
  EventRow,
  EventRowInline,
  EventTimestamp,
} from './feed'
import {ResourceToken} from './resource-token'

export function DocUpdateEvent({event}: {event: LoadedDocUpdateEvent}) {
  const route: NavRoute = {
    key: 'document',
    id: event.docId,
  }
  return (
    <EventRowInline route={route}>
      <EventContact contact={event.author} />
      <EventDescriptionText>updated</EventDescriptionText>
      <ResourceToken id={event.docId} metadata={event.document.metadata} />
      <EventTimestamp time={event.time} />
    </EventRowInline>
  )
}

export function CommentBlobEvent({event}: {event: LoadedCommentEvent}) {
  return (
    <EventRow>
      {event.comment && (
        <Comment
          comment={event.comment}
          heading={
            <div className="flex w-full items-center overflow-hidden">
              <EventContact contact={event.author} />
              <EventDescriptionText>commented on</EventDescriptionText>
              {event.targetId ? (
                <ResourceToken
                  id={event.targetId}
                  metadata={event.targetMetadata}
                />
              ) : null}
              <EventTimestamp time={event.time} />
            </div>
          }
        />
      )}
    </EventRow>
  )
}

export function CapabilityBlobEvent({event}: {event: LoadedCapabilityEvent}) {
  const route: NavRoute | null = event.targetId
    ? {
        key: 'document',
        id: event.targetId,
        accessory: {
          key: 'collaborators',
        },
      }
    : null
  return (
    <EventRowInline route={route}>
      <EventContact contact={event.author} />
      <EventDescriptionText>invited</EventDescriptionText>
      <EventContacts contacts={event.delegates} />
      <EventDescriptionText>as collaborators</EventDescriptionText>
      <EventTimestamp time={event.time} />
    </EventRowInline>
  )
}

export function ContactBlobEvent({event}: {event: LoadedContactEvent}) {
  const route: NavRoute = {
    key: 'document',
    id: event.contact.id,
  }
  return (
    <EventRowInline route={route}>
      <EventContact contact={event.author} />
      <EventDescriptionText>updated their contact for</EventDescriptionText>
      <EventContact contact={event.contact} />
      <EventTimestamp time={event.time} />
    </EventRowInline>
  )
}

export function FeedEvent({event}: {event: LoadedFeedEvent}) {
  if (event.type === 'contact') {
    return <ContactBlobEvent event={event} />
  }
  if (event.type === 'capability') {
    return <CapabilityBlobEvent event={event} />
  }
  if (event.type === 'comment') {
    return <CommentBlobEvent event={event} />
  }
  if (event.type === 'doc-update') {
    return <DocUpdateEvent event={event} />
  }
  return null
}
