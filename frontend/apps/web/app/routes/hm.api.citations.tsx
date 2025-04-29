import {queryClient} from '@/client'
import {getMetadata, resolveHMDocument} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, hmId, parseFragment, unpackHmId} from '@shm/shared'
import {
  HMCitation,
  HMCitationsPayload,
  HMDocumentCitation,
} from '@shm/shared/hm-types'

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMCitationsPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)
  if (!id) throw new Error('id is required')
  let result: HMCitationsPayload | {error: string}
  try {
    const res = await queryClient.entities.listEntityMentions({
      id: id.id,
      pageSize: BIG_INT,
    })

    console.log(`== ~ res:`, res)

    const documentCitations: HMDocumentCitation[] = []

    for (const mention of res.mentions) {
      const sourceId = unpackHmId(mention.source)
      if (!sourceId) continue
      if (sourceId.type !== 'd') continue

      const targetFragment = parseFragment(mention.targetFragment)
      const targetId = hmId(id.type, id.uid, {
        path: id.path,
        version: mention.targetVersion,
      })
      const citation: HMCitation = {
        source: {
          id: sourceId,
          type: 'd',
          author: mention.sourceBlob?.author,
          time: mention.sourceBlob?.createTime,
        },
        targetFragment,
        targetId,
        isExactVersion: mention.isExactVersion,
      }
      const document = await resolveHMDocument(sourceId)
      const author = citation.source.author
        ? await getMetadata(hmId('d', citation.source.author))
        : null
      if (document) {
        const documentCitation: HMDocumentCitation = {
          ...citation,
          document,
          author,
        }
        documentCitations.push(documentCitation)
      }
    }

    result = documentCitations
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
