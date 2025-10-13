import {HMContactItem, resolveAccount} from '../account-utils'
import {prepareHMComment, prepareHMDocument} from '../document-utils'
import {GRPCClient} from '../grpc-client'
import {
  HMCapability,
  HMComment,
  HMDocument,
  HMMetadata,
  HMTimestamp,
  UnpackedHypermediaId,
} from '../hm-types'
import {hmId, unpackHmId} from '../utils'

export type ListEventsRequest = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
  addLinkedResource?: string[]
}

export type ListEventsResponse = {
  events: Event[]
  nextPageToken: string
}

export type Event = {
  newBlob: NewBlobEvent
  account: string
  eventTime: HMTimestamp | null
  observeTime: HMTimestamp | null
}

export type NewBlobEvent = {
  cid: string
  blobType: string
  author: string
  resource: string
  extraAttrs: string
  blobId: string
  isPinned: boolean
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
  target: {
    id: UnpackedHypermediaId | null
    metadata: HMMetadata | null
  }
  targetId?: UnpackedHypermediaId | null
  targetMetadata?: HMMetadata | null
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
  // deprecate
  targetMetadata?: HMMetadata | null
  // deprecate
  targetId?: UnpackedHypermediaId | null
  target: HMContactItem | null
}

export type LoadedRefEvent = {
  id: string
  type: 'doc-update'
  author: HMContactItem
  time: HMTimestamp
  docId: UnpackedHypermediaId
  document: HMDocument
}

export type LoadedEvent =
  | LoadedCommentEvent
  | LoadedRefEvent
  | LoadedCapabilityEvent
  | LoadedContactEvent
//| LoadedDagPBEvent
//| LoadedProfileEvent

export interface ActivityService {
  /**
   * Lists recent activity events, sorted by locally observed time (newest first)
   * Used to get activity feed with optional filters for authors, event types, and resources
   */
  listEvents(params: ListEventsRequest): Promise<ListEventsResponse>

  /**
   * Resolves an event into its loaded form with additional data
   * Handles all event types internally based on event.data.case
   */
  resolveEvent(
    event: Event,
    currentAccount?: string,
  ): Promise<LoadedEvent | null>
}

/**
 * Shared gRPC implementation for listEvents
 * This function is called by both web (via API route) and desktop (directly)
 * to ensure zero duplication of the gRPC logic
 */
export async function listEventsImpl(
  grpcClient: GRPCClient,
  params: ListEventsRequest,
): Promise<ListEventsResponse> {
  const response = await grpcClient.activityFeed.listEvents({
    pageSize: params.pageSize || 5,
    pageToken: params.pageToken || '',
    trustedOnly: params.trustedOnly || false,
    filterAuthors: params.filterAuthors || [],
    filterEventType: params.filterEventType || [],
    filterResource: params.filterResource || '',
    addLinkedResource: params.addLinkedResource || [],
  })

  return response.toJson({emitDefaultValues: true}) as ListEventsResponse
}

export async function loadCommentEvent(
  grpcClient: GRPCClient,
  event: Event,
  currentAccount?: string,
): Promise<LoadedCommentEvent | null> {
  if (event.newBlob.blobType.toLowerCase() != 'comment') {
    console.error('Event: not a comment event: ', event)
    return null
  }

  try {
    const comment = await grpcClient.comments.getComment({
      id: event.newBlob.cid,
    })

    const author = await resolveAccount(
      grpcClient,
      comment.author,
      currentAccount,
    )

    const replyingComment = comment.replyParent
      ? await grpcClient.comments.getComment({
          id: comment.replyParent,
        })
      : null

    const replyingAuthor = replyingComment?.author
      ? await resolveAccount(grpcClient, replyingComment.author, currentAccount)
      : null

    const targetDoc = await grpcClient.documents.getDocument({
      account: comment.targetAccount,
      version: comment.targetVersion,
      path: comment.targetPath,
    })

    const targetId = hmId(comment.targetAccount, {
      path: comment.targetPath
        ? comment.targetPath.split('/').filter(Boolean)
        : null,
      version: comment.targetVersion || null,
    })

    const target: HMContactItem = {
      id: targetId,
      metadata: targetDoc.metadata?.toJson({emitDefaultValues: true}) as
        | HMMetadata
        | undefined,
    }

    return {
      id: comment.id,
      type: 'comment',
      author,
      time: event.eventTime as any,
      replyingComment: replyingComment
        ? prepareHMComment(replyingComment)
        : null,
      replyingAuthor,
      comment: comment ? prepareHMComment(comment) : null,
      commentId: unpackHmId(`hm://${comment.id}`)!,
      target,
    }
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}

export async function loadCapabilityEvent(
  grpcClient: GRPCClient,
  event: Event,
  currentAccount?: string,
): Promise<LoadedCapabilityEvent | null> {
  if (event.newBlob.blobType.toLowerCase() != 'capability')
    throw Error('this is not a capability event.')

  try {
    const author = await resolveAccount(
      grpcClient,
      event.newBlob.author,
      currentAccount,
    )

    const capId = unpackHmId(event.newBlob.resource)

    if (!capId) {
      console.error(
        'loadCapabilityEvent Error, unpacking resource id',
        event.newBlob.resource,
      )

      return null
    }

    const grpcCapability = await grpcClient.accessControl.getCapability({
      id: event.newBlob.cid,
    })

    console.log(`== ~ loadCapabilityEvent ~ grpcCapability:`, grpcCapability)

    const target = await grpcClient.documents.getDocument({
      account: grpcCapability.account,
      path: grpcCapability.path,
    })

    const delegate = await resolveAccount(
      grpcClient,
      grpcCapability.delegate,
      currentAccount,
    )

    return {
      id: capId?.uid!,
      type: 'capability',
      author,
      targetId: null,
      targetMetadata: null,
      target: {
        id: null,
        metadata:
          (target.metadata?.toJson({emitDefaultValues: true}) as HMMetadata) ||
          null,
      },
      time: event.eventTime!,
      delegates: delegate ? [delegate] : [],
      capabilityId: capId,
      capability: {
        id: grpcCapability.id,
        accountUid: grpcCapability.account,
      } as any, // Temporary type assertion until proper capability schema is available
    }
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}

export async function loadContactEvent(
  grpcClient: GRPCClient,
  event: Event,
  currentAccount?: string,
): Promise<LoadedContactEvent | null> {
  if (event.newBlob.blobType.toLowerCase() != 'contact') {
    console.error('Event: not a contact event:', event)
    return null
  }

  try {
    const resourceId = unpackHmId(event.newBlob.resource)

    const author = await resolveAccount(
      grpcClient,
      event.newBlob.author,
      currentAccount,
    )

    const contact = resourceId
      ? await resolveAccount(grpcClient, resourceId.uid, currentAccount)
      : null

    return resourceId
      ? {
          type: 'contact',
          time: event.eventTime || '',
          author,
          contact: {
            id: resourceId,
            metadata: contact?.metadata,
          },
          id: resourceId.uid,
        }
      : null
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}

export async function loadRefEvent(
  grpcClient: GRPCClient,
  event: Event,
  currentAccount?: string,
): Promise<LoadedRefEvent | null> {
  if (event.newBlob.blobType.toLowerCase() != 'ref') {
    console.error('Event: not a ref event:', event)
    return null
  }

  try {
    const author = await resolveAccount(
      grpcClient,
      event.account,
      currentAccount,
    )

    console.log('== REF EVENT', event)

    const docId = unpackHmId(event.newBlob.resource)

    console.log(`== ~ loadRefEvent ~ docId:`, docId)
    const grpcDocument = await grpcClient.documents.getDocument({
      account: docId?.uid,
      path: docId?.path?.length ? `/${docId?.path?.join('/')}` : '',
      version: docId?.version || undefined,
    })

    // const change = await grpcClient.entities.getEntityTimeline({
    //   id: grpcDocument.,
    // })

    return docId
      ? {
          id: event.newBlob.resource,
          type: 'doc-update',
          time: event.eventTime || '',
          docId,
          author,
          document: prepareHMDocument(grpcDocument),
        }
      : null
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}
