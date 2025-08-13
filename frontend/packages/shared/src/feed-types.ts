import {
  HMCapability,
  HMComment,
  HMDocument,
  HMMetadata,
  HMTimestamp,
  UnpackedHypermediaId,
} from './hm-types'

export type HMContactItem = {
  id: UnpackedHypermediaId
  metadata?: HMMetadata
}

export type HMResourceItem = {
  id: UnpackedHypermediaId
  type: 'contact' | 'capability' | 'comment' | 'document'
  metadata?: HMMetadata
}

export type LoadedContactEvent = {
  id: string
  type: 'contact'
  author: HMContactItem
  time: HMTimestamp
  contact: HMContactItem
  //   contactData: HMContact | null
}

export type LoadedCapabilityEvent = {
  id: string
  type: 'capability'
  author: HMContactItem
  time: HMTimestamp
  delegates: HMContactItem[]
  capabilityId: UnpackedHypermediaId
  capability: HMCapability
  targetId: UnpackedHypermediaId | null
  targetMetadata: HMMetadata | null
}

export type LoadedCommentEvent = {
  id: string
  type: 'comment'
  author: HMContactItem
  time: HMTimestamp
  replyingComment: HMComment | null
  replyingAuthor: HMContactItem | null
  comment: HMComment | null
  commentId: UnpackedHypermediaId
  targetMetadata: HMMetadata | null
  targetId: UnpackedHypermediaId | null
}

export type LoadedDocUpdateEvent = {
  id: string
  type: 'doc-update'
  author: HMContactItem
  time: HMTimestamp
  docId: UnpackedHypermediaId
  document: HMDocument
}

export type LoadedFeedEvent =
  | LoadedContactEvent
  | LoadedCapabilityEvent
  | LoadedCommentEvent
  | LoadedDocUpdateEvent
