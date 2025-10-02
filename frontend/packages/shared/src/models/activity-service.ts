import {GRPCClient} from '../grpc-client'
import {HMTimestamp} from '../hm-types'

export type ListEventsRequest = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
  addLinkedResource?: string[]
}

export type ListEventsResponse = {
  events: Event[]
  nextPageToken: string
}

export type Event = {
  data: {
    case: 'newBlob'
    value: NewBlobEvent
  } | null
  account: string
  eventTime: HMTimestamp | null
  observeTime: HMTimestamp | null
}

export type NewBlobEvent = {
  cid: string
  blobType: string
  author: string
  resource: string
  extraAttrs: string
  blobId: string
  isPinned: boolean
}

export interface ActivityService {
  /**
   * Lists recent activity events, sorted by locally observed time (newest first)
   * Used to get activity feed with optional filters for authors, event types, and resources
   */
  listEvents(params: ListEventsRequest): Promise<ListEventsResponse>
}

/**
 * Shared gRPC implementation for listEvents
 * This function is called by both web (via API route) and desktop (directly)
 * to ensure zero duplication of the gRPC logic
 */
export async function listEventsImpl(
  grpcClient: GRPCClient,
  params: ListEventsRequest,
): Promise<ListEventsResponse> {
  const response = await grpcClient.activityFeed.listEvents({
    pageSize: params.pageSize || 5,
    pageToken: params.pageToken || '',
    trustedOnly: params.trustedOnly || false,
    filterAuthors: params.filterAuthors || [],
    filterEventType: params.filterEventType || [],
    filterResource: params.filterResource || '',
    addLinkedResource: params.addLinkedResource || [],
  })

  return response.toJson() as ListEventsResponse
}
