import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {json} from '@remix-run/node'
import {
  getEventType,
  HMEvent,
  loadCapabilityEvent,
  loadCitationEvent,
  loadCommentEvent,
  loadContactEvent,
  LoadedEvent,
  loadRefEvent,
} from '@shm/shared/models/activity-service'

export type ResolveEventRequest = {
  event: HMEvent
  currentAccount?: string
}

export const action = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<LoadedEvent | null>> => {
  if (request.method !== 'POST') {
    throw json({error: 'Method not allowed'}, {status: 405})
  }

  const {event, currentAccount} = (await request.json()) as ResolveEventRequest

  if (!event) {
    throw json({error: 'Missing event'}, {status: 400})
  }

  const eventType = getEventType(event)

  if (!eventType) {
    console.error('Unable to determine event type:', event)
    return wrapJSON(null)
  }

  try {
    let result: LoadedEvent | null = null

    switch (eventType) {
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
      case 'citation':
      case 'comment/target':
      case 'comment/embed':
      case 'comment/link':
      case 'doc/embed':
      case 'doc/link':
      case 'doc/button':
        result = await loadCitationEvent(grpcClient, event, currentAccount)
        break
      case 'profile':
      case 'dagpb':
        result = null
        break
      default:
        console.warn(`Unknown event type: ${eventType}`)
        result = null
    }

    return wrapJSON(result)
  } catch (e: any) {
    console.error('Error resolving event:', e)
    return wrapJSON({error: e.message})
  }
}
