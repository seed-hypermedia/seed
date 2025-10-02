import {
  ActivityService,
  ListEventsRequest,
  ListEventsResponse,
} from '@shm/shared/models/activity-service'
import {queryAPI} from './models'

export class WebActivityService implements ActivityService {
  async listEvents(params: ListEventsRequest): Promise<ListEventsResponse> {
    const searchParams = new URLSearchParams()

    if (params.pageSize) {
      searchParams.set('pageSize', params.pageSize.toString())
    }
    if (params.pageToken) {
      searchParams.set('pageToken', params.pageToken)
    }
    if (params.trustedOnly) {
      searchParams.set('trustedOnly', 'true')
    }
    if (params.filterAuthors) {
      params.filterAuthors.forEach((a) =>
        searchParams.append('filterAuthors', a),
      )
    }
    if (params.filterEventType) {
      params.filterEventType.forEach((t) =>
        searchParams.append('filterEventType', t),
      )
    }
    if (params.filterResource) {
      searchParams.set('filterResource', params.filterResource)
    }
    if (params.addLinkedResource) {
      params.addLinkedResource.forEach((r) =>
        searchParams.append('addLinkedResource', r),
      )
    }

    const queryUrl = `/api/feed?${searchParams.toString()}`
    return await queryAPI<ListEventsResponse>(queryUrl)
  }
}
