import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  hmId,
  ListDocumentsResponse,
  unpackHmId,
} from '@shm/shared'
import {prepareHMDocumentInfo} from '@shm/shared/models/entity'

export type HMDirectory = PlainMessage<ListDocumentsResponse>

export type DirectoryPayload = {
  directory?: HMDocumentInfo[]
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
  const mode = url.searchParams.get('mode') || 'Children'
  if (!id) throw new Error('id is required')
  let result: DirectoryPayload
  try {
    const res = await grpcClient.documents.listDocuments({
      account: id.uid,
    })
    const idPathLength = id.path?.length || 0
    const directory = res.documents
      .map((d) => prepareHMDocumentInfo(d))
      .filter((doc) => {
        if (doc.id.path?.length) return false
        if (!doc.id.id.startsWith(id.id)) return false
        // For Children mode, only include direct children
        if (mode === 'Children') {
          return doc.id.path?.length === idPathLength + 1
        }
        // For AllDescendants mode, include all descendants
        return true
      })
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
