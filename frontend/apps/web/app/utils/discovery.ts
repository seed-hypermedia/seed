import {queryClient} from '@/client'
import {HMDocumentSchema, hmIdPathToEntityQueryPath} from '@shm/shared'
import {
  documentMetadataParseAdjustments,
  getErrorMessage,
  HMRedirectError,
} from '@shm/shared/models/entity'
import {tryUntilSuccess} from './try-until-success'

export async function discoverDocument(
  uid: string,
  path: string[],
  version?: string,
) {
  await queryClient.entities.discoverEntity({
    account: uid,
    path: hmIdPathToEntityQueryPath(path),
    version,
    recursive: true,
  })
  console.log('discoverDocument', uid, path, version)
  return await tryUntilSuccess(
    async () => {
      console.log('discover will getDocument', uid, path, version)
      const apiDoc = await queryClient.documents.getDocument({
        account: uid,
        path: hmIdPathToEntityQueryPath(path),
        version: version,
      })
      const versionMatch = !version || apiDoc.version === version
      console.log('discover getDocument', versionMatch, apiDoc.version, version)
      if (versionMatch) {
        const docJSON = apiDoc.toJson() as any
        documentMetadataParseAdjustments(docJSON.metadata)
        const document = HMDocumentSchema.parse(docJSON)
        console.log('discover getDocument complete', document)
        return document
      }
      return null
    },
    {
      immediateCatch: (e) => {
        const error = getErrorMessage(e)
        return error instanceof HMRedirectError
      },
    },
  )
}
