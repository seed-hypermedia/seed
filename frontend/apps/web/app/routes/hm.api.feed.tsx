import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {createFeedLoader} from '@shm/shared/feed-loader'

export type HMFeedPayload = {
  events: any[]
  nextPageToken: string
}

const {loadDocumentFeed} = createFeedLoader(grpcClient)

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
  if (!filterResource) throw new Error('filterResource is required')
  let result: HMFeedPayload | {error: string}
  try {
    const result = await loadDocumentFeed({
      pageToken,
      pageSize,
      filterAuthors,
      filterResource,
      filterEventType,
    })
    if (result.nextPageToken === pageToken) {
      return wrapJSON({events: [], nextPageToken: pageToken})
    }
    return wrapJSON(result)
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
