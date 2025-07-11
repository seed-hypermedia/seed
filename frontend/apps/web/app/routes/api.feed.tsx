import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'

export const loader = apiGetter(async (req) => {
  const nextPageToken = req.searchParams.get('nextPageToken') || undefined
  const pageSize = parseInt(req.searchParams.get('pageSize') || '10', 10)
  const doc = await queryClient.activityFeed.listEvents({
    pageSize,
    pageToken: nextPageToken,
  })
  return doc.toJson()
})
