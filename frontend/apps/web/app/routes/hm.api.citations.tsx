import {queryClient} from '@/client'
import {getMetadata, loadComment, resolveHMDocument} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, hmId, parseFragment, unpackHmId} from '@shm/shared'
import {
  HMCitation,
  HMCitationsPayload,
  HMCommentCitation,
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

    const documentCitations: Array<HMDocumentCitation | HMCommentCitation> = []

    for (const mention of res.mentions) {
      const sourceId = unpackHmId(mention.source)
      if (!sourceId) continue
      const targetFragment = parseFragment(mention.targetFragment)
      const targetId = hmId(id.type, id.uid, {
        path: id.path,
        version: mention.targetVersion,
      })
      if (sourceId.type == 'c') {
        try {
          const citation: HMCitation = {
            source: {
              id: sourceId,
              type: 'c',
              author: mention.sourceBlob?.author,
              time: mention.sourceBlob?.createTime,
            },
            targetFragment,
            targetId,
            isExactVersion: mention.isExactVersion,
          }
          const comment = await loadComment(sourceId)
          const author = citation.source.author
            ? await getMetadata(hmId('d', citation.source.author))
            : null
          const commentCitation: HMCommentCitation = {
            ...citation,
            comment,
            author,
          }
          documentCitations.push(commentCitation)
        } catch (error) {
          console.error('=== comment citation error', error)
        }
      } else if (sourceId.type == 'd') {
        try {
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
        } catch (error) {
          console.error('=== citation error', error)
        }
      }
    }

    result = documentCitations
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
