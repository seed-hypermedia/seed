import {Document} from './client'
import {HMDocumentSchema} from './hm-types'
import {documentMetadataParseAdjustments} from './models/entity'

export function prepareHMDocument(apiDoc: Document) {
  const docJSON = apiDoc.toJson() as any
  documentMetadataParseAdjustments(docJSON.metadata)
  const document = HMDocumentSchema.parse(docJSON)
  return document
}
