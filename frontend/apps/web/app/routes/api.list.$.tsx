import {grpcClient} from '@/client.server'
import {apiGetter} from '@/server-api'
import {
  entityQueryPathToHmIdPath,
  HMDocumentMetadataSchema,
  hmId,
} from '@shm/shared'
import {ListAPIResponse} from '@shm/shared/api-types'
import {BIG_INT} from '@shm/shared/constants'

const processDocuments = (docs: any[]) => {
  const invalidDocuments: ListAPIResponse['invalidDocuments'] = []
  const documents: ListAPIResponse['documents'] = []

  docs.forEach((doc) => {
    const id = hmId(
      doc.account,
      doc.path ? {path: entityQueryPathToHmIdPath(doc.path)} : undefined,
    )
    const rawMetadata = doc.metadata?.toJson()
    const metadataParsed = HMDocumentMetadataSchema.safeParse(rawMetadata)

    if (!metadataParsed.success) {
      invalidDocuments.push({
        id,
        error: metadataParsed.error,
        metadata: rawMetadata,
      })
    } else {
      documents.push({
        id,
        metadata: metadataParsed.data,
      })
    }
  })

  return {invalidDocuments, documents}
}

export const loader = apiGetter(async (req) => {
  const pathParts = req.pathParts
  const [_api, _list, uid] = pathParts

  if (uid) {
    const docs = await grpcClient.documents.listDocuments({
      account: uid,
      pageSize: BIG_INT,
    })
    const {invalidDocuments, documents} = processDocuments(docs.documents)
    return {invalidDocuments, documents} satisfies ListAPIResponse
  } else {
    const rootDocs = await grpcClient.documents.listRootDocuments({
      pageSize: BIG_INT,
    })
    const {invalidDocuments, documents} = processDocuments(rootDocs.documents)
    return {invalidDocuments, documents} satisfies ListAPIResponse
  }
})
