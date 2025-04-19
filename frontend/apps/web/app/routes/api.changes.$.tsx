import {queryClient} from '@/client'
import {json, LoaderFunction} from '@remix-run/node'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'
import {withCors} from '../utils/cors'

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').slice(1)
  const [_api, _document, uid, ...restPath] = pathParts
  const result = await queryClient.documents.listDocumentChanges({
    account: uid,
    path: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return withCors(json(result.toJson()))
}
