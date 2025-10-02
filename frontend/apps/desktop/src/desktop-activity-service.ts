import {
  ActivityService,
  ListEventsRequest,
  ListEventsResponse,
  listEventsImpl,
} from '@shm/shared/models/activity-service'
import {grpcClient} from './grpc-client'

export class DesktopActivityService implements ActivityService {
  async listEvents(params: ListEventsRequest): Promise<ListEventsResponse> {
    return listEventsImpl(grpcClient, params)
  }
}
