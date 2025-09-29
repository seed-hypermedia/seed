import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {unpackHmId} from '@shm/shared'
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

  const id = unpackHmId(url.searchParams.get('id') || undefined)
  const pageToken = url.searchParams.get('pageToken') || undefined
  if (!id) throw new Error('id is required')
  let result: HMFeedPayload | {error: string}
  try {
    const result = await loadDocumentFeed(id, pageToken)
    if (result.nextPageToken === pageToken) {
      return wrapJSON({events: [], nextPageToken: pageToken})
    }
    return wrapJSON(result)
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
