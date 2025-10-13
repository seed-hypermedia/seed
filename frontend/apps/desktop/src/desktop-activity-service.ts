import {
  ActivityService,
  HMEvent,
  HMListEventsRequest,
  HMListEventsResponse,
  LoadedEvent,
  listEventsWithCitationsImpl,
  loadCapabilityEvent,
  loadCitationEvent,
  loadCommentEvent,
  loadContactEvent,
  loadRefEvent,
} from '@shm/shared/models/activity-service'
import {grpcClient} from './grpc-client'

export class DesktopActivityService implements ActivityService {
  async listEvents(params: HMListEventsRequest): Promise<HMListEventsResponse> {
    return listEventsWithCitationsImpl(grpcClient, params)
  }

  async resolveEvent(
    event: HMEvent,
    currentAccount?: string,
  ): Promise<LoadedEvent | null> {
    // Determine event type from blobType or other fields
    const blobType = event.newBlob.blobType.toLowerCase()

    switch (blobType) {
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
        return loadCitationEvent(grpcClient, event, currentAccount)
      case 'dagpb':
      case 'profile':
        return null
      default:
        // Fallback for unknown types
        throw new Error(`Unknown event type: ${blobType}`)
    }
  }
}
