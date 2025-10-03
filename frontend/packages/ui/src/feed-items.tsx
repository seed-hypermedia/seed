import {
  LoadedCapabilityEvent,
  LoadedCommentEvent,
  LoadedContactEvent,
  LoadedDocUpdateEvent,
  LoadedFeedEvent,
} from '@shm/shared/feed-types'
import {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {useTxString} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {useCallback} from 'react'
import {Button} from './button'
import {Comment} from './comments'
import {copyTextToClipboard} from './copy-to-clipboard'
import {
  EventContact,
  EventContacts,
  EventDescriptionText,
  EventRow,
  EventRowInline,
  EventTimestamp,
  FeedItemHeader,
  FeedItemWrapper,
} from './feed'
import {Link} from './icons'
import {ResourceToken} from './resource-token'
import {toast} from './toast'
import {Tooltip} from './tooltip'

export function DocUpdateEvent({event}: {event: LoadedDocUpdateEvent}) {
  const route: NavRoute = {
    key: 'document',
    id: event.docId,
  }
  const linkProps = useRouteLink(route)
  return (
    <FeedItemWrapper {...linkProps}>
      <FeedItemHeader>
        <EventContact contact={event.author} />
        <EventDescriptionText>updated</EventDescriptionText>
        <ResourceToken id={event.docId} metadata={event.document.metadata} />
        <EventTimestamp time={event.time} />
      </FeedItemHeader>
    </FeedItemWrapper>
  )
}

export function CommentBlobEvent({event}: {event: LoadedCommentEvent}) {
  const tx = useTxString()
  const getUrl = useResourceUrl(event.targetId?.hostname || undefined)
  const handleCopyLink = useCallback(() => {
    const url = getUrl(event.commentId)
    copyTextToClipboard(url)
    toast.success('Copied Comment URL')
  }, [event.commentId])
  return (
    <EventRow onClick={handleCopyLink}>
      {event.comment && (
        <Comment
          comment={event.comment}
          heading={
            <div className="flex items-center">
              <div className="flex w-full flex-1 flex-wrap items-center overflow-hidden">
                <EventContact contact={event.author} />
                <EventDescriptionText>commented on</EventDescriptionText>
                {event.targetId ? (
                  <ResourceToken
                    id={event.targetId}
                    metadata={event.targetMetadata}
                  />
                ) : null}
              </div>
              <EventTimestamp time={event.time} />
              <Tooltip content={tx('Copy Comment Link')}>
                <Button
                  size="iconSm"
                  variant="ghost"
                  className="text-muted-foreground opacity-0 transition-opacity duration-200 ease-in-out group-hover:opacity-100"
                  onClick={handleCopyLink}
                >
                  <Link className="size-3" />
                </Button>
              </Tooltip>
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
