import {queryClient} from '@/client'
import {wrapJSON} from '@/wrapping'
import {SearchPayload, unpackHmId} from '@shm/shared'

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url)
  const searchQuery = url.searchParams.get('q') || ''
  const accountUid = url.searchParams.get('a') || ''
  const includeBody = url.searchParams.get('b') === 'true'
  const contextSize = parseInt(url.searchParams.get('c') || '26', 10)
  const result = await queryClient.entities.searchEntities({
    query: searchQuery,
    includeBody: includeBody,
    contextSize: contextSize,
    accountUid: accountUid,
  })

  return wrapJSON<SearchPayload>({
    searchQuery,
    entities: result.entities
      .map((entity) => {
        const id = unpackHmId(entity.id)
        return (
          id && {
            id,
            title: entity.content,
            icon: entity.icon,
            parentNames: entity.parentNames,
            versionTime: entity.versionTime,
            searchQuery: searchQuery,
          }
        )
      })
      .filter((result) => !!result),
  })
}
