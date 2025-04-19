import {queryClient} from '@/client'
import {json, LoaderFunction} from '@remix-run/node'
import {BIG_INT, hmId, packHmId} from '@shm/shared'
import {withCors} from '../utils/cors'

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').slice(1)
  const [_api, _document, uid, ...restPath] = pathParts
  const result = await queryClient.entities.listEntityMentions({
    id: packHmId(
      hmId('d', uid, {
        path: restPath,
      }),
    ),
    pageSize: BIG_INT,
  })
  return withCors(json(result.toJson()))
}
