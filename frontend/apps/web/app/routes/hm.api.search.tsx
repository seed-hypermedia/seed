import {queryClient} from '@/client'
import {wrapJSON} from '@/wrapping'
import {SearchPayload, unpackHmId} from '@shm/shared'

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url)
  const searchQuery = url.searchParams.get('q') || ''
  const result = await queryClient.entities.searchEntities({
    query: searchQuery,
  })

  return wrapJSON<SearchPayload>({
    searchQuery,
    entities: result.entities
      .map((entity) => {
        const id = unpackHmId(entity.id)
        return (
          id && {
            id,
            title: entity.title,
          }
        )
      })
      .filter((result) => !!result),
  })
}
