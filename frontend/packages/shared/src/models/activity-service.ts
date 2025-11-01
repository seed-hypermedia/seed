import {HMContactItem, resolveAccount} from '../account-utils'
import {Mention} from '../client/.generated/entities/v1alpha/entities_pb'
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
import {hmId, parseFragment, unpackHmId} from '../utils'

export type HMListEventsRequest = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
}

export type HMListEventsResponse = {
  events: HMEvent[]
  nextPageToken: string
}

export type HMEvent =
  | {
      newBlob: HMNewBlobEvent
      account: string
      eventTime: HMTimestamp | null
      observeTime: HMTimestamp | null
    }
  | {
      newMention: Mention
      account: string
      eventTime: HMTimestamp | null
      observeTime: HMTimestamp | null
    }

export type HMNewBlobEvent = {
  cid: string
  blobType: string
  author: string
  resource: string
  extraAttrs: string
  blobId: string
  isPinned: boolean
  // For citations, store the mention data
  mention?: Mention
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
  contact: {
    id: UnpackedHypermediaId
    name: string
    subject: HMContactItem
  }
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
  replyParentAuthor: HMContactItem | null
  comment: HMComment | null
  commentId: UnpackedHypermediaId
  // deprecate
  targetMetadata?: HMMetadata | null
  // deprecate
  targetId?: UnpackedHypermediaId | null
  target: HMContactItem | null
  replyCount: number
}

export type LoadedRefEvent = {
  id: string
  type: 'doc-update'
  author: HMContactItem
  time: HMTimestamp
  docId: UnpackedHypermediaId
  document: HMDocument
}

export type LoadedCitationEvent = {
  id: string
  type: 'citation'
  citationType: 'd' | 'c' // 'd' = document reference, 'c' = comment reference
  author: HMContactItem
  time: HMTimestamp
  source: HMContactItem // The document/comment containing the citation
  target: HMContactItem // The document being cited (with fragment)
  targetFragment?: string // Block ID or fragment being cited
  comment?: HMComment | null // The comment content (when citationType === 'c')
  replyCount?: number // Reply count for comment citations (when citationType === 'c')
}

export type LoadedEvent =
  | LoadedCommentEvent
  | LoadedRefEvent
  | LoadedCapabilityEvent
  | LoadedContactEvent
  | LoadedCitationEvent
//| LoadedDagPBEvent
//| LoadedProfileEvent

/**
 * Helper to get event type from either newBlob or newMention
 */
export function getEventType(event: HMEvent): string | null {
  // Check for newMention using 'in' operator for proper type narrowing
  if ('newMention' in event) {
    // For newMention events, sourceType contains the full type like "doc/Embed" or "comment/Link"
    const sourceType = event.newMention.sourceType?.toLowerCase()

    if (sourceType) {
      return sourceType
    }

    return 'citation'
  }

  // Check for newBlob using 'in' operator for proper type narrowing
  if ('newBlob' in event) {
    return event.newBlob.blobType.toLowerCase()
  }

  return null
}

export interface ActivityService {
  /**
   * Lists recent activity events, sorted by locally observed time (newest first)
   * Used to get activity feed with optional filters for authors, event types, and resources
   */
  listEvents(params: HMListEventsRequest): Promise<HMListEventsResponse>

  /**
   * Resolves an event into its loaded form with additional data
   * Handles all event types internally based on event.data.case
   */
  resolveEvent(
    event: HMEvent,
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
  params: HMListEventsRequest,
): Promise<HMListEventsResponse> {
  const response = await grpcClient.activityFeed.listEvents({
    pageSize: params.pageSize || 5,
    pageToken: params.pageToken || '',
    trustedOnly: params.trustedOnly || false,
    filterAuthors: params.filterAuthors || [],
    filterEventType: params.filterEventType || [
      'Ref',
      'Capability',
      'Comment',
      'DagPB',
      'Profile',
      'Contact',
      // "comment/Target",
      'comment/Embed',
      'doc/Embed',
      'doc/Link',
      'doc/Button',
    ],
    filterResource: params.filterResource || '',
  })

  let res = response.toJson({
    emitDefaultValues: true,
  }) as unknown as HMListEventsResponse

  return res
}

export async function loadCommentEvent(
  grpcClient: GRPCClient,
  event: HMEvent,
  currentAccount?: string,
): Promise<LoadedCommentEvent | null> {
  if ('newMention' in event) {
    console.error('Event: missing newBlob for comment event:', event)
    return null
  }

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

    const replyParentAuthor = replyingComment?.author
      ? await resolveAccount(grpcClient, replyingComment.author, currentAccount)
      : null

    const targetDoc = await grpcClient.documents.getDocument({
      account: comment.targetAccount,
      version: comment.targetVersion,
      path: comment.targetPath,
    })

    const replyCountResponse = await grpcClient.comments.getCommentReplyCount({
      id: comment.id,
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
      id: event.newBlob.cid,
      type: 'comment',
      author,
      time: event.eventTime as any,
      replyingComment: replyingComment
        ? prepareHMComment(replyingComment)
        : null,
      replyParentAuthor,
      comment: comment ? prepareHMComment(comment) : null,
      commentId: unpackHmId(`hm://${comment.id}`)!,
      target,
      replyCount: Number(replyCountResponse.replyCount),
    }
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}

export async function loadCapabilityEvent(
  grpcClient: GRPCClient,
  event: HMEvent,
  currentAccount?: string,
): Promise<LoadedCapabilityEvent | null> {
  if ('newMention' in event) {
    console.error('Event: missing newBlob for capability event:', event)
    return null
  }

  if (event.newBlob.blobType.toLowerCase() != 'capability') {
    console.error('Event: not a capability event:', event)
    return null
  }

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
      id: event.newBlob.cid,
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
  event: HMEvent,
  currentAccount?: string,
): Promise<LoadedContactEvent | null> {
  if ('newMention' in event) {
    console.error('Event: missing newBlob for contact event:', event)
    return null
  }

  if (event.newBlob.blobType.toLowerCase() != 'contact') {
    console.error('Event: not a contact event:', event)
    return null
  }

  try {
    // Parse extraAttrs to get tsid and name
    let extraAttrs: {tsid?: string; name?: string} = {}
    try {
      extraAttrs = JSON.parse(event.newBlob.extraAttrs)
    } catch (error) {
      console.error('Failed to parse extraAttrs:', error)
    }

    // Construct contact ID: author + tsid
    if (!extraAttrs.tsid) {
      console.error('Missing tsid for contact event:', event)
      return null
    }

    const contactId = `${event.newBlob.author}/${extraAttrs.tsid}`

    // Get contact from API
    const grpcContact = await grpcClient.documents.getContact({
      id: contactId,
    })

    const subject = await resolveAccount(grpcClient, grpcContact.subject)

    const author = await resolveAccount(
      grpcClient,
      event.newBlob.author,
      currentAccount,
    )

    // Construct contact item
    const contactUnpackedId = unpackHmId(`hm://${contactId}`)
    if (!contactUnpackedId) {
      console.error('Failed to unpack contact ID:', contactId)
      return null
    }

    return {
      type: 'contact',
      time: event.eventTime || '',
      author,
      contact: {
        id: contactUnpackedId,
        name: extraAttrs.name || '',
        subject,
      },
      id: event.newBlob.cid,
    }
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}

export async function loadRefEvent(
  grpcClient: GRPCClient,
  event: HMEvent,
  currentAccount?: string,
): Promise<LoadedRefEvent | null> {
  if ('newMention' in event) {
    console.error('Event: missing newBlob for ref event:', event)
    return null
  }

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

    const docId = unpackHmId(event.newBlob.resource)

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
          id: event.newBlob.cid,
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

export async function loadCitationEvent(
  grpcClient: GRPCClient,
  event: HMEvent,
  currentAccount?: string,
): Promise<LoadedCitationEvent | null> {
  if ('newBlob' in event) {
    console.error('Event: not a citation event (invalid blobType):', event)
    return null
  }

  try {
    const targetFragment = parseFragment(event.newMention.targetFragment)

    // Determine citationType: 'd' = document reference, 'c' = comment reference
    const sourceTypeLower = event.newMention.sourceType?.toLowerCase() || ''
    const citationType =
      sourceTypeLower.startsWith('doc/') || sourceTypeLower === 'ref'
        ? 'd'
        : sourceTypeLower.startsWith('comment/') ||
          sourceTypeLower === 'comment'
        ? 'c'
        : null

    if (!citationType) {
      console.error(
        'Event: Could not determine citationType from sourceType:',
        sourceTypeLower,
      )
      return null
    }

    // Create source UnpackedHmId from event.newMention.source
    const sourceUnpacked = unpackHmId(event.newMention.source)
    if (!sourceUnpacked) {
      console.error('Event: Could not unpack source:', event.newMention.source)
      return null
    }

    const sourceId = hmId(sourceUnpacked.uid, {
      path: sourceUnpacked.path,
      version: event.newMention.sourceBlob?.cid || null,
      blockRef: event.newMention.sourceContext || null,
    })

    // Create target UnpackedHmId from event.newMention.target
    const targetUnpacked = unpackHmId(event.newMention.target)
    if (!targetUnpacked) {
      console.error('Event: Could not unpack target:', event.newMention.target)
      return null
    }

    const targetId = hmId(targetUnpacked.uid, {
      path: targetUnpacked.path,
      version: event.newMention.targetVersion || null,
      blockRef: targetFragment?.blockId || null,
      blockRange:
        targetFragment?.type == 'block-range'
          ? {
              start: targetFragment.start,
              end: targetFragment.end,
            }
          : null,
    })

    // Resolve author
    const authorUid = event.newMention.sourceBlob?.author || event.account
    const author = await resolveAccount(grpcClient, authorUid, currentAccount)

    // Fetch source document metadata
    let sourceDocument
    try {
      sourceDocument = await grpcClient.documents.getDocument({
        account: sourceUnpacked.uid,
        path: sourceUnpacked.path?.length
          ? `/${sourceUnpacked.path.join('/')}`
          : '',
        version: event.newMention.sourceBlob?.cid || undefined,
      })
    } catch (error) {
      console.error('Event: Failed to fetch source document:', error)
      return null
    }

    const source: HMContactItem = {
      id: sourceId,
      metadata: sourceDocument?.metadata?.toJson({emitDefaultValues: true}) as
        | HMMetadata
        | undefined,
    }

    // Fetch target document metadata
    let targetDocument
    try {
      targetDocument = await grpcClient.documents.getDocument({
        account: targetUnpacked.uid,
        path: targetUnpacked.path?.length
          ? `/${targetUnpacked.path.join('/')}`
          : '',
        version: event.newMention.targetVersion || undefined,
      })
    } catch (error) {
      console.error('Event: Failed to fetch target document:', error)
      return null
    }

    const target: HMContactItem = {
      id: targetId,
      metadata: targetDocument?.metadata?.toJson({emitDefaultValues: true}) as
        | HMMetadata
        | undefined,
    }

    // Generate unique event ID
    const eventId = event.newMention.targetFragment
      ? `${event.newMention.sourceBlob?.cid}-${event.newMention.targetFragment}`
      : event.newMention.sourceBlob?.cid || ''

    // Fetch comment content if this is a comment citation
    let comment: HMComment | null = null
    let replyCount: number | undefined = undefined
    if (citationType === 'c') {
      try {
        const commentCid = event.newMention.sourceBlob?.cid
        if (commentCid) {
          const grpcComment = await grpcClient.comments.getComment({
            id: commentCid,
          })
          comment = prepareHMComment(grpcComment)

          const replyCountResponse =
            await grpcClient.comments.getCommentReplyCount({
              id: commentCid,
            })
          replyCount = Number(replyCountResponse.replyCount)
        }
      } catch (error) {
        console.error('Event: Failed to load comment for citation:', error)
      }
    }

    return {
      id: eventId,
      type: 'citation',
      citationType,
      author,
      time: event.eventTime || '',
      source,
      target,
      targetFragment: event.newMention.targetFragment || undefined,
      comment,
      replyCount,
    }
  } catch (error) {
    console.error('Event: catch error:', event, error)
    return null
  }
}
