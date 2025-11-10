import {grpcClient} from '@/client.server'
import {getAccount, resolveHMDocument} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {hmId, parseFragment, unpackHmId} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
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
    const res = await grpcClient.entities.listEntityMentions({
      id: id.id,
      pageSize: BIG_INT,
    })

    const docCitations: HMCitation[] = []
    for (const mention of res.mentions) {
      const sourceId = unpackHmId(mention.source)
      if (!sourceId) continue
      const targetFragment = parseFragment(mention.targetFragment)
      const targetId = hmId(id.uid, {
        path: id.path,
        version: mention.targetVersion,
      })
      docCitations.push({
        source: {
          id: sourceId,
          type: 'd',
          author: mention.sourceBlob?.author,
          time: mention.sourceBlob?.createTime,
        },
        targetFragment,
        targetId,
        isExactVersion: mention.isExactVersion,
      })
    }
    let documentCitations: Array<HMDocumentCitation> = []
    for (const citation of docCitations) {
      try {
        const document = await resolveHMDocument(citation.source.id)
        const author = citation.source.author
          ? await getAccount(citation.source.author)
          : null
        if (document) {
          documentCitations.push({
            ...citation,
            document,
            author,
          })
        }
      } catch (error) {
        console.error('=== citation error', error)
      }
    }

    result = documentCitations
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
