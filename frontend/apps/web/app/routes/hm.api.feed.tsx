import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {listEventsWithCitationsImpl} from '@shm/shared/models/activity-service'

export type HMFeedPayload = {
  events: any[]
  nextPageToken: string
}

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMFeedPayload>> => {
  const url = new URL(request.url)
  const pageToken = url.searchParams.get('pageToken') || undefined
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10)
  const filterAuthors =
    url.searchParams.get('filterAuthors')?.split(',') || undefined
  const filterResource = url.searchParams.get('filterResource') || undefined
  const filterEventType =
    url.searchParams.get('filterEventType')?.split(',') || undefined
  try {
    const result = await listEventsWithCitationsImpl(grpcClient, {
      pageToken,
      pageSize,
      filterAuthors,
      filterResource,
      filterEventType,
    })
    return wrapJSON(result)
  } catch (error: any) {
    return wrapJSON({error: error.message})
  }
}
