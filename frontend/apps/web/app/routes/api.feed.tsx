import {grpcClient} from '@/client.server'
import {apiGetter} from '@/server-api'
import {
  listEventsImpl,
  ListEventsRequest,
} from '@shm/shared/models/activity-service'

export const loader = apiGetter(async (req) => {
  const params: ListEventsRequest = {
    pageSize: parseInt(req.searchParams.get('pageSize') || '10', 10),
    pageToken: req.searchParams.get('pageToken') || undefined,
    trustedOnly: req.searchParams.get('trustedOnly') === 'true',
    filterAuthors: req.searchParams.getAll('filterAuthors'),
    filterEventType: req.searchParams.getAll('filterEventType'),
    filterResource: req.searchParams.get('filterResource') || undefined,
    addLinkedResource: req.searchParams.getAll('addLinkedResource'),
  }

  return listEventsImpl(grpcClient, params)
})
