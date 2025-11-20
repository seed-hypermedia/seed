import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  hmId,
  unpackHmId,
} from '@shm/shared'
import {getQueryResultsWithClient} from '@shm/shared/models/directory'

export type DirectoryPayload = {
  directory?: HMDocumentInfo[]
  accountsMetadata?: HMAccountsMetadata
  error?: string
}

const loadQueryResults = getQueryResultsWithClient(grpcClient)

export const loader = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<DirectoryPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)
  const mode = (url.searchParams.get('mode') || 'Children') as
    | 'Children'
    | 'AllDescendants'
  if (!id) throw new Error('id is required')
  let result: DirectoryPayload
  try {
    const queryResult = await loadQueryResults({
      includes: [
        {
          space: id.uid,
          mode,
          path: id.path?.join('/'),
        },
      ],
    })
    const directory = queryResult?.results || []
    const allAuthors = new Set<string>()
    directory.forEach((doc) => {
      doc.authors.forEach((author) => allAuthors.add(author))
    })
    const accounts = await Promise.all(
      Array.from(allAuthors).map(async (authorUid) => {
        const res = await grpcClient.documents.getDocument({
          account: authorUid,
        })
        const authorAccount = {
          ...toPlainMessage(res),
          metadata: HMDocumentMetadataSchema.parse(
            res.metadata?.toJson({emitDefaultValues: true}),
          ),
        }
        return {id: hmId(authorUid), metadata: authorAccount.metadata}
      }),
    )
    result = {
      directory,
      accountsMetadata: Object.fromEntries(accounts.map((a) => [a.id.uid, a])),
    }
  } catch (e: any) {
    result = {error: e.message}
  }
  return wrapJSON(result)
}
