import {grpcClient} from '@/client.server'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {toPlainMessage} from '@bufbuild/protobuf'
import {Params} from '@remix-run/react'
import {
  HMDocumentChangeInfo,
  hmIdPathToEntityQueryPath,
  normalizeDate,
  unpackHmId,
} from '@shm/shared'

export type ChangesPayload = {
  changes: Array<HMDocumentChangeInfo>
  latestVersion: string
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
  let result: ChangesPayload
  try {
    const latestDoc = await grpcClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: undefined,
    })
    const res = await grpcClient.documents.listDocumentChanges({
      account: id.uid,
      path: id.path && id.path.length > 0 ? '/' + id.path.join('/') : '',
      version: latestDoc.version,
    })
    // todo, avoid this dumb behavior of fetching the author metadata for every change. most changes will come from the same few authors.
    result = {
      changes: (
        await Promise.all(
          res.changes.map(async (serverChange) => {
            const change = toPlainMessage(serverChange)
            const author = await getAccount(change.author)
            const createTime = normalizeDate(change.createTime)?.toISOString()
            if (!createTime) return null
            return {
              ...change,
              createTime,
              author,
            }
          }),
        )
      ).filter((change) => change !== null),
      latestVersion: latestDoc.version,
    }
  } catch (e: any) {
    // @ts-expect-error
    result = {error: (e as Error).message}
  }

  return wrapJSON(result)
}
