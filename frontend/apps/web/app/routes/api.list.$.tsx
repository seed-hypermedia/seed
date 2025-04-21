import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {
  entityQueryPathToHmIdPath,
  HMDocumentMetadataSchema,
  hmId,
} from '@shm/shared'
import {ListAPIResponse} from '@shm/shared/api-types'
import {BIG_INT} from '@shm/shared/constants'

export const loader = apiGetter(async (req) => {
  const pathParts = req.pathParts
  const [_api, _list, uid] = pathParts
  if (uid) {
    const docs = await queryClient.documents.listDocuments({
      account: uid,
      pageSize: BIG_INT,
    })
    return {
      documents: docs.documents.map((doc) => ({
        id: hmId('d', doc.account, {path: entityQueryPathToHmIdPath(doc.path)}),
        metadata: HMDocumentMetadataSchema.parse(doc.metadata?.toJson()),
      })),
    } satisfies ListAPIResponse
  } else {
    const rootDocs = await queryClient.documents.listRootDocuments({
      pageSize: BIG_INT,
    })
    return {
      documents: rootDocs.documents.map((doc) => ({
        id: hmId('d', doc.account),
        metadata: HMDocumentMetadataSchema.parse(doc.metadata?.toJson()),
      })),
    } satisfies ListAPIResponse
  }
})
