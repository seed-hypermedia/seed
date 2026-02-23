import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMListEventsRequest} from './hm-types'
import {
  getEventAtMs,
  getFeedEventId,
  getEventType,
  HMActivityEvent,
  listEventsImpl,
  loadCapabilityEvent,
  loadCitationEvent,
  loadCommentEvent,
  loadContactEvent,
  LoadedEvent,
  LoadedEventWithNotifMeta,
  loadRefEvent,
} from './models/activity-service'
import {createRequestCache, RequestCache} from './request-cache'

async function resolveEvent(
  grpcClient: GRPCClient,
  event: HMActivityEvent,
  currentAccount: string | undefined,
  cache: RequestCache,
): Promise<LoadedEventWithNotifMeta | null> {
  try {
    const eventType = getEventType(event)

    if (!eventType) {
      console.error('Unable to determine event type:', event)
      return null
    }

    let resolvedEvent: LoadedEvent | null = null
    switch (eventType) {
      case 'comment':
        resolvedEvent = await loadCommentEvent(grpcClient, event, currentAccount, cache)
        break
      case 'ref':
        resolvedEvent = await loadRefEvent(grpcClient, event, currentAccount, cache)
        break
      case 'capability':
        resolvedEvent = await loadCapabilityEvent(grpcClient, event, currentAccount, cache)
        break
      case 'contact':
        resolvedEvent = await loadContactEvent(grpcClient, event, currentAccount, cache)
        break
      case 'citation':
      case 'comment/target':
      case 'comment/embed':
      case 'comment/link':
      case 'doc/target':
      case 'doc/embed':
      case 'doc/link':
      case 'doc/button':
        resolvedEvent = await loadCitationEvent(grpcClient, event, currentAccount, cache)
        break
      case 'dagpb':
      case 'profile':
        return null
      default:
        console.warn(`Unknown event type: ${eventType}`)
        return null
    }

    if (!resolvedEvent) return null

    const feedEventId = getFeedEventId(event)
    if (!feedEventId) {
      console.warn('Missing feedEventId for event:', event)
      return null
    }

    return {
      ...resolvedEvent,
      feedEventId,
      eventAtMs: getEventAtMs(event),
    }
  } catch (error) {
    console.error('Error resolving event:', event, error)
    return null
  }
}

export const ListEvents: HMRequestImplementation<HMListEventsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    // Get raw events from gRPC
    const response = await listEventsImpl(grpcClient, input)

    // Create request-scoped cache to deduplicate resource fetches
    // This ensures that if multiple events reference the same account/document/comment,
    // only one gRPC call is made for each unique resource
    const cache = createRequestCache(grpcClient)

    // Resolve all events server-side
    const resolvedEvents = await Promise.allSettled(
      response.events.map((event) => resolveEvent(grpcClient, event, input.currentAccount, cache)),
    )

    // Filter out failed promises and null values
    const events = resolvedEvents
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => (result as PromiseFulfilledResult<LoadedEvent>).value)

    return {
      events,
      nextPageToken: response.nextPageToken,
    }
  },
}
