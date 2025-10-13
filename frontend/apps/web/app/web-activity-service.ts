import {
  ActivityService,
  HMEvent,
  HMListEventsRequest,
  HMListEventsResponse,
  LoadedEvent,
} from '@shm/shared/models/activity-service'
import {queryAPI} from './models'
import {unwrap} from './wrapping'

export class WebActivityService implements ActivityService {
  async listEvents(params: HMListEventsRequest): Promise<HMListEventsResponse> {
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

    const queryUrl = `/hm/api/feed?${searchParams.toString()}`
    return await queryAPI<HMListEventsResponse>(queryUrl)
  }

  async resolveEvent(
    event: HMEvent,
    currentAccount?: string,
  ): Promise<LoadedEvent | null> {
    const response = await fetch('/api/activity/resolve-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({event, currentAccount}, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to resolve event')
    }

    const wrappedResult = await response.json()
    return unwrap<LoadedEvent | null>(wrappedResult)
  }
}
