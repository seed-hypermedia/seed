import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {json} from '@remix-run/node'
import {
  Event,
  loadCapabilityEvent,
  loadCommentEvent,
  loadContactEvent,
  LoadedEvent,
  loadRefEvent,
} from '@shm/shared/models/activity-service'

export type ResolveEventRequest = {
  event: Event
  currentAccount?: string
}

export const action = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<LoadedEvent | null>> => {
  console.log('== DEBUG api/resolve-event', request.body)
  if (request.method !== 'POST') {
    throw json({error: 'Method not allowed'}, {status: 405})
  }

  const {event, currentAccount} = (await request.json()) as ResolveEventRequest

  if (!event) {
    throw json({error: 'Missing event'}, {status: 400})
  }

  const blobType = event.newBlob.blobType.toLowerCase()
  console.log('== DEBUG RESOLVING EVENT', blobType, event.newBlob.cid)

  try {
    let result: LoadedEvent | null = null

    switch (blobType) {
      case 'comment':
        result = await loadCommentEvent(grpcClient, event, currentAccount)
        break
      case 'ref':
        result = await loadRefEvent(grpcClient, event, currentAccount)
        break
      case 'capability':
        result = await loadCapabilityEvent(grpcClient, event, currentAccount)
        break
      case 'contact':
        result = await loadContactEvent(grpcClient, event, currentAccount)
        break
      case 'dagpb':
        result = null
        break
      default:
        throw new Error(`Unknown event type: ${blobType}`)
    }

    console.log('== DEBUG api/event resolved', result)

    return wrapJSON(result)
  } catch (e: any) {
    console.error('Error resolving event:', e)
    return wrapJSON({error: e.message})
  }
}
