import {toPlainMessage} from '@bufbuild/protobuf'
import {Document} from './client'
import {HMDocument, HMDocumentSchema} from './hm-types'

export function toHMDocument(grpcDocument: Document): null | HMDocument {
  const serverDocument = toPlainMessage(grpcDocument)

  const result = HMDocumentSchema.safeParse({
    ...serverDocument,
    metadata: convertUglyAPIMetadata(serverDocument.metadata),
  })
  if (result.success) {
    return result.data
  } else {
    console.error('Invalid Document!', serverDocument, result.error)
  }
  return null
}

function convertUglyAPIMetadata(metadata: any): any {
  return Object.fromEntries(
    Object.entries(metadata.fields).map(([key, value]) => {
      // @ts-ignore
      return [key, value.kind.value]
    }),
  )
}
