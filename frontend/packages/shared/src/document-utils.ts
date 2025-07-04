import {Comment, Document} from './client'
import {
  HMComment,
  HMCommentSchema,
  HMDocument,
  HMDocumentSchema,
} from './hm-types'
import {documentMetadataParseAdjustments} from './models/entity'

export function prepareHMDocument(apiDoc: Document): HMDocument {
  const docJSON = apiDoc.toJson() as any
  documentMetadataParseAdjustments(docJSON.metadata)
  const document = HMDocumentSchema.parse(docJSON)
  return document
}

export function prepareHMComment(apiComment: Comment): HMComment {
  const commentJSON = apiComment.toJson() as any
  documentMetadataParseAdjustments(commentJSON.metadata)
  const comment = HMCommentSchema.parse(commentJSON)
  return comment
}
