import {
  ActivityService,
  HMEvent,
  HMListEventsRequest,
  HMListEventsResponse,
  LoadedEvent,
  getEventType,
  listEventsImpl,
  loadCapabilityEvent,
  loadCitationEvent,
  loadCommentEvent,
  loadContactEvent,
  loadRefEvent,
} from '@shm/shared/models/activity-service'
import {grpcClient} from './grpc-client'

export class DesktopActivityService implements ActivityService {
  async listEvents(params: HMListEventsRequest): Promise<HMListEventsResponse> {
    return listEventsImpl(grpcClient, params)
  }

  async resolveEvent(
    event: HMEvent,
    currentAccount?: string,
  ): Promise<LoadedEvent | null> {
    // Get event type from either newBlob or newMention
    const eventType = getEventType(event)

    if (!eventType) {
      console.error('Unable to determine event type:', event)
      return null
    }

    console.log('== EVENT TYPE', eventType)

    switch (eventType) {
      case 'comment':
        let res = await loadCommentEvent(grpcClient, event, currentAccount)
        return res
      case 'ref':
        return loadRefEvent(grpcClient, event, currentAccount)
      case 'capability':
        return loadCapabilityEvent(grpcClient, event, currentAccount)
      case 'contact':
        return loadContactEvent(grpcClient, event, currentAccount)
      case 'citation':
      case 'comment/target':
      case 'comment/embed':
      case 'comment/link':
      case 'doc/embed':
      case 'doc/link':
      case 'doc/button':
        return loadCitationEvent(grpcClient, event, currentAccount)
      case 'dagpb':
      case 'profile':
        return null
      default:
        // Fallback for unknown types
        console.warn(`Unknown event type: ${eventType}`)
        return null
    }
  }
}
