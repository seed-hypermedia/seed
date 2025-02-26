import {queryClient} from '@/client'
import {getMetadata} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {hmId, HMMetadata, UnpackedHypermediaId, unpackHmId} from '@shm/shared'

export type HMDocumentChangeInfo = {
  author: {id: UnpackedHypermediaId; metadata: HMMetadata}
  createTime: string
  deps: Array<string>
  id: string
}

export type ChangesPayload = {
  changes?: Array<HMDocumentChangeInfo>
}

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<ChangesPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)

  if (!id) throw new Error('id is required')
  let result // TODO type this
  try {
    const res = await queryClient.documents.listDocumentChanges({
      account: id.uid,
      path: id.path && id.path.length > 0 ? '/' + id.path.join('/') : '',
      version: id.version || undefined,
    })
    // todo, avoid this dumb behavior of fetching the author metadata for every change. most changes will come from the same few authors.
    result = await Promise.all(
      res.changes.map(async (change) => {
        const author = await getMetadata(hmId('d', change.author))
        return {
          ...change,
          author,
        }
      }),
    )
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
