import {grpcClient} from '@/client.server'
import {wrapJSON} from '@/wrapping.server'
import {SearchPayload, unpackHmId} from '@shm/shared'

export const loader = async ({request}: {request: Request}) => {
  const url = new URL(request.url)

  const searchQuery = url.searchParams.get('q') || ''
  const accountUid = url.searchParams.get('a') || ''
  const includeBody = url.searchParams.get('b') === 'true'
  const perspectiveAccountUid = url.searchParams.get('d') || ''

  const contextSizeRaw = url.searchParams.get('c')
  const contextSize =
    contextSizeRaw && !isNaN(Number(contextSizeRaw))
      ? parseInt(contextSizeRaw, 10)
      : 26

  const result = await grpcClient.entities.searchEntities({
    query: searchQuery,
    includeBody,
    contextSize,
    accountUid,
    loggedAccountUid: perspectiveAccountUid,
  })

  return wrapJSON<SearchPayload>({
    searchQuery,
    // @ts-expect-error
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
            type: entity.type === 'contact' ? 'contact' : 'document',
          }
        )
      })
      .filter((result) => !!result),
  })
}
