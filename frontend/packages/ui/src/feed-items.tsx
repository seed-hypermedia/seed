import {
  LoadedCapabilityEvent,
  LoadedCommentEvent,
  LoadedContactEvent,
  LoadedDocUpdateEvent,
  LoadedFeedEvent,
} from '@shm/shared/feed-types'
import {Comment} from './discussion'
import {
  EventContact,
  EventContacts,
  EventDescriptionText,
  EventRow,
  EventTimestamp,
} from './feed'
import {ResourceToken} from './resource-token'

export function DocUpdateEvent({event}: {event: LoadedDocUpdateEvent}) {
  console.log('~~! DocUpdateEvent', event)
  return (
    <EventRow>
      <EventContact contact={event.author} />
      <EventDescriptionText>updated</EventDescriptionText>
      <ResourceToken id={event.docId} metadata={event.document.metadata} />
      <EventTimestamp time={event.time} />
    </EventRow>
  )
}

export function CommentBlobEvent({event}: {event: LoadedCommentEvent}) {
  console.log('~~! CommentBlobEvent', event)

  return (
    <>
      <EventRow>
        <EventContact contact={event.author} />
        <EventDescriptionText>commented on</EventDescriptionText>
        {event.targetId ? (
          <ResourceToken id={event.targetId} metadata={event.targetMetadata} />
        ) : null}
        <EventTimestamp time={event.time} />
      </EventRow>
      {event.comment && <Comment comment={event.comment} />}
    </>
  )
}

export function CapabilityBlobEvent({event}: {event: LoadedCapabilityEvent}) {
  console.log('~~! CapabilityBlobEvent', event)
  return (
    <EventRow>
      <EventContact contact={event.author} />
      <EventDescriptionText>invited</EventDescriptionText>
      <EventContacts contacts={event.delegates} />
      <EventDescriptionText>as collaborators</EventDescriptionText>
      <EventTimestamp time={event.time} />
    </EventRow>
  )
}

export function ContactBlobEvent({event}: {event: LoadedContactEvent}) {
  console.log('~~! ContactBlobEvent', event)
  return (
    <EventRow>
      <EventContact contact={event.author} />
      <EventDescriptionText>updated their contact for</EventDescriptionText>
      <EventContact contact={event.contact} />
      <EventTimestamp time={event.time} />
    </EventRow>
  )
}

export function FeedEvent({event}: {event: LoadedFeedEvent}) {
  console.log('~~! FeedEvent', event)
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
