import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {hmIdPathToEntityQueryPath} from '@shm/shared'

export const loader = apiGetter(async (req) => {
  const pathParts = req.pathParts
  const [_api, _document, type, uid, ...restPath] = pathParts
  if (type === 'd') {
    const doc = await queryClient.documents.getDocument({
      account: uid,
      path: hmIdPathToEntityQueryPath(restPath),
      version: req.searchParams.get('v') || undefined,
    })
    return doc.toJson()
  }
  if (type === 'c') {
    const comment = await queryClient.comments.getComment({
      id: uid,
    })
    return comment.toJson()
  }
  throw new Error('Invalid entity type, document only')
})
