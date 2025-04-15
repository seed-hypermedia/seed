import {queryClient} from '@/client'
import {getHMDocument, getMetadata} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {
  BIG_INT,
  HMDocument,
  hmId,
  HMMetadataPayload,
  unpackHmId,
} from '@shm/shared'
import {HMCitation} from '@shm/shared/hm-types'

export type HMDocumentCitation = HMCitation & {
  document: HMDocument
  author: HMMetadataPayload | null
}

export type CitationsPayload = Array<HMDocumentCitation>

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<CitationsPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)

  if (!id) throw new Error('id is required')
  let result // TODO type this
  try {
    const res = await queryClient.entities.listEntityMentions({
      id: id.id,
      pageSize: BIG_INT,
    })
    result = (
      await Promise.all(
        res.mentions.map(async (mention) => {
          const sourceId = unpackHmId(mention.source)
          if (!sourceId) return null
          const sourceDocId = sourceId.type === 'd' ? sourceId : null
          if (!sourceDocId) return null
          const document = await getHMDocument(sourceDocId)
          const author = mention.sourceBlob?.author
            ? await getMetadata(hmId('d', mention.sourceBlob?.author))
            : null
          return {
            ...mention,
            author,
            document,
          }
        }),
      )
    ).filter((m) => !!m)
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
