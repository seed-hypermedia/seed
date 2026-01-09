import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMListEventsRequest} from './hm-types'
import {
  getEventType,
  HMActivityEvent,
  listEventsImpl,
  loadCapabilityEvent,
  loadCitationEvent,
  loadCommentEvent,
  loadContactEvent,
  LoadedEvent,
  loadRefEvent,
} from './models/activity-service'
import {createRequestCache, RequestCache} from './request-cache'

async function resolveEvent(
  grpcClient: GRPCClient,
  event: HMActivityEvent,
  currentAccount: string | undefined,
  cache: RequestCache,
): Promise<LoadedEvent | null> {
  try {
    const eventType = getEventType(event)

    if (!eventType) {
      console.error('Unable to determine event type:', event)
      return null
    }

    switch (eventType) {
      case 'comment':
        return loadCommentEvent(grpcClient, event, currentAccount, cache)
      case 'ref':
        return loadRefEvent(grpcClient, event, currentAccount, cache)
      case 'capability':
        return loadCapabilityEvent(grpcClient, event, currentAccount, cache)
      case 'contact':
        return loadContactEvent(grpcClient, event, currentAccount, cache)
      case 'citation':
      case 'comment/target':
      case 'comment/embed':
      case 'comment/link':
      case 'doc/embed':
      case 'doc/link':
      case 'doc/button':
        return loadCitationEvent(grpcClient, event, currentAccount, cache)
      case 'dagpb':
      case 'profile':
        return null
      default:
        console.warn(`Unknown event type: ${eventType}`)
        return null
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
      response.events.map((event) =>
        resolveEvent(grpcClient, event, input.currentAccount, cache),
      ),
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
