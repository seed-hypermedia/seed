import {Comment, Document} from './client'
import {HMCommentSchema, HMDocumentSchema} from './hm-types'
import {documentMetadataParseAdjustments} from './models/entity'

export function prepareHMDocument(apiDoc: Document) {
  const docJSON = apiDoc.toJson() as any
  documentMetadataParseAdjustments(docJSON.metadata)
  const document = HMDocumentSchema.parse(docJSON)
  return document
}

export function prepareHMComment(apiComment: Comment) {
  const commentJSON = apiComment.toJson() as any
  documentMetadataParseAdjustments(commentJSON.metadata)
  const comment = HMCommentSchema.parse(commentJSON)
  return comment
}
