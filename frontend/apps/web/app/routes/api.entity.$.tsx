import {queryClient} from '@/client'
import {json, LoaderFunction} from '@remix-run/node'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {withCors} from '../utils/cors'

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').slice(1)
  const [_api, _document, type, uid, ...restPath] = pathParts
  if (type !== 'd') {
    throw new Error('Invalid entity type, document only')
  }
  const doc = await queryClient.documents.getDocument({
    account: uid,
    path: hmIdPathToEntityQueryPath(restPath),
  })
  return withCors(json(doc.toJson()))
}
