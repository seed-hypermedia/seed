import {queryClient} from '@/client'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  HMAccountsMetadata,
  HMDocumentMetadataSchema,
  hmId,
  HMMetadata,
  HMTimestamp,
  ListDocumentsResponse,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'

export type HMDirectory = PlainMessage<ListDocumentsResponse>

export type DirectoryPayload = {
  directory?: {
    path: string
    metadata: HMMetadata
    updateTime?: HMTimestamp
    id: UnpackedHypermediaId
    authors: string[]
  }[]
  accountsMetadata?: HMAccountsMetadata
  error?: string
}

export const loader = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<DirectoryPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)
  if (!id) throw new Error('id is required')
  let result: DirectoryPayload
  try {
    const res = await queryClient.documents.listDocuments({
      account: id.uid,
    })
    const pathPrefix = id.path ? '/' + id.path.join('/') : '/'
    const idPathLength = id.path?.length || 0
    const directory = res.documents
      .map((d) => ({
        ...toPlainMessage(d),
        metadata: HMDocumentMetadataSchema.parse(
          d.metadata?.toJson({emitDefaultValues: true}),
        ),
      }))
      .filter(
        (doc) =>
          doc.path !== '/' &&
          doc.path !== '' &&
          doc.path !== pathPrefix &&
          doc.path.startsWith(pathPrefix) &&
          doc.path.split('/').slice(1).length === idPathLength + 1,
      )
      .map((doc) => {
        return {
          path: doc.path,
          updateTime: doc.updateTime,
          metadata: doc.metadata,
          id: hmId(id.uid, {path: doc.path.split('/').slice(1)}),
          authors: doc.authors,
        }
      })
    const allAuthors = new Set<string>()
    directory.forEach((doc) => {
      doc.authors.forEach((author) => allAuthors.add(author))
    })
    const accounts = await Promise.all(
      Array.from(allAuthors).map(async (authorUid) => {
        const res = await queryClient.documents.getDocument({
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
