import {queryClient} from '@/client'
import type {LoaderFunctionArgs} from '@remix-run/node'
import {json} from '@remix-run/node'
import {HMDocumentMetadataSchema, hmId} from '@shm/shared'
import {ListAPIResponse} from '@shm/shared/api-types'
import {BIG_INT} from '@shm/shared/constants'
import {withCors} from '../utils/cors'

export const loader = async ({request}: LoaderFunctionArgs) => {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').slice(1)
  const [_api, _list, uid] = pathParts
  if (uid) {
    const docs = await queryClient.documents.listDocuments({
      account: uid,
      pageSize: BIG_INT,
    })
    return withCors(
      json({
        documents: docs.documents.map((doc) => ({
          id: hmId('d', doc.account),
          metadata: HMDocumentMetadataSchema.parse(doc.metadata),
        })),
      } satisfies ListAPIResponse),
    )
  } else {
    const rootDocs = await queryClient.documents.listRootDocuments({
      pageSize: BIG_INT,
    })
    return withCors(
      json({
        documents: rootDocs.documents.map((doc) => ({
          id: hmId('d', doc.account),
          metadata: HMDocumentMetadataSchema.parse(doc.metadata?.toJson()),
        })),
      } satisfies ListAPIResponse),
    )
  }
}
