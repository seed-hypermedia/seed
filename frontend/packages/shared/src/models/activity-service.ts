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
import {hmId, unpackHmId} from '../utils'

export type HMListEventsRequest = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
  addLinkedResource?: string[]
}

export type HMListEventsResponse = {
  events: HMEvent[]
  nextPageToken: string
}

export type HMEvent = {
  newBlob: HMNewBlobEvent
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
}

export type LoadedEvent =
  | LoadedCommentEvent
  | LoadedRefEvent
  | LoadedCapabilityEvent
  | LoadedContactEvent
  | LoadedCitationEvent
//| LoadedDagPBEvent
//| LoadedProfileEvent

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
    filterEventType: params.filterEventType || [],
    filterResource: params.filterResource || '',
    addLinkedResource: params.addLinkedResource || [],
  })

  return response.toJson({
    emitDefaultValues: true,
  }) as unknown as HMListEventsResponse
}

type CompositePageToken = {
  eventsToken: string
  mentionsToken: string
}

function encodePageToken(token: CompositePageToken): string {
  if (!token.eventsToken && !token.mentionsToken) return ''
  return Buffer.from(JSON.stringify(token)).toString('base64')
}

function decodePageToken(token: string): CompositePageToken {
  if (!token) return {eventsToken: '', mentionsToken: ''}
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString())
  } catch {
    return {eventsToken: '', mentionsToken: ''}
  }
}

/**
 * Unified implementation that merges listEvents and listEntityMentions
 * Citations are wrapped as events with blobType: 'Citation'
 */
export async function listEventsWithCitationsImpl(
  grpcClient: GRPCClient,
  params: HMListEventsRequest & {filterResource?: string},
): Promise<HMListEventsResponse> {
  const {eventsToken, mentionsToken} = decodePageToken(params.pageToken || '')
  const pageSize = params.pageSize || 20

  // Fetch both APIs in parallel
  const [eventsResponse, mentionsResponse] = await Promise.allSettled([
    eventsToken !== null
      ? grpcClient.activityFeed
          .listEvents({
            pageSize,
            pageToken: eventsToken,
            trustedOnly: params.trustedOnly || false,
            filterAuthors: params.filterAuthors || [],
            filterEventType: params.filterEventType || [],
            filterResource: params.filterResource || '',
            addLinkedResource: params.addLinkedResource || [],
          })
          .then(
            (r) =>
              r.toJson({
                emitDefaultValues: true,
              }) as unknown as HMListEventsResponse,
          )
          .catch(() => ({events: [], nextPageToken: ''}))
      : Promise.resolve({events: [], nextPageToken: ''}),
    mentionsToken !== null && params.filterResource
      ? grpcClient.entities
          .listEntityMentions({
            id: params.filterResource,
            pageSize,
            pageToken: mentionsToken,
            reverseOrder: true, // newest first
          })
          .catch(() => ({mentions: [], nextPageToken: ''}))
      : Promise.resolve({mentions: [], nextPageToken: ''}),
  ])

  const events =
    eventsResponse.status === 'fulfilled' ? eventsResponse.value.events : []
  const eventsNextToken =
    eventsResponse.status === 'fulfilled'
      ? eventsResponse.value.nextPageToken
      : ''

  const mentions =
    mentionsResponse.status === 'fulfilled'
      ? mentionsResponse.value.mentions
      : []
  const mentionsNextToken =
    mentionsResponse.status === 'fulfilled'
      ? mentionsResponse.value.nextPageToken
      : ''

  // Wrap citations as events
  const citationEvents: HMEvent[] = []

  mentions.forEach((mention: Mention) => {
    // FILTER 1: Only include comments (not document references)
    // if (mention.sourceType !== 'Comment') {
    //   console.log('Skipping non-comment mention:', mention.sourceType)
    //   return
    // }

    // FILTER 2: EXCLUDE comments that directly target filterResource
    // (those are already returned by listEvents API)
    if (mention.sourceDocument) {
      const sourceDocId = unpackHmId(mention.sourceDocument)
      const targetDocId = unpackHmId(params.filterResource || '')

      if (sourceDocId && targetDocId) {
        // Check if the comment's document matches our target
        const isSameAccount = sourceDocId.uid === targetDocId.uid
        const isSamePath =
          (sourceDocId.path?.join('/') || '') ===
          (targetDocId.path?.join('/') || '')

        if (isSameAccount && isSamePath) {
          console.log(
            'Skipping comment directly on target document:',
            mention.sourceDocument,
          )
          return // Skip comments that are ON the target document
        }
      }
    }

    const createTime = mention.sourceBlob?.createTime
    const seconds =
      typeof createTime?.seconds === 'bigint'
        ? createTime.seconds
        : BigInt(createTime?.seconds || 0)

    citationEvents.push({
      newBlob: {
        cid: mention.sourceBlob?.cid || '',
        blobType: 'Citation',
        author: mention.sourceBlob?.author || '',
        resource: mention.source, // The source (document/comment with the citation)
        extraAttrs: params.filterResource || '', // Store target ID here
        blobId: mention.sourceBlob?.cid || '',
        isPinned: false,
        mention,
      },
      account: mention.sourceBlob?.author || '',
      eventTime: createTime
        ? {
            seconds,
            nanos: createTime.nanos,
          }
        : null,
      observeTime: null,
    })
  })

  // Merge and sort by date (newest first)
  const allEvents = [...events, ...citationEvents].sort((a, b) => {
    const getTime = (time: HMTimestamp | null): bigint => {
      if (!time) return BigInt(0)
      if (typeof time === 'string') return BigInt(0)
      return typeof time.seconds === 'bigint'
        ? time.seconds
        : BigInt(time.seconds)
    }

    const timeA = getTime(a.eventTime)
    const timeB = getTime(b.eventTime)
    return timeA > timeB ? -1 : timeA < timeB ? 1 : 0
  })

  // Create composite next page token
  const nextPageToken = encodePageToken({
    eventsToken: eventsNextToken,
    mentionsToken: mentionsNextToken,
  })

  return {
    events: allEvents,
    nextPageToken,
  }
}

export async function loadCommentEvent(
  grpcClient: GRPCClient,
  event: HMEvent,
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
  event: HMEvent,
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
  event: HMEvent,
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
  event: HMEvent,
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

export async function loadCitationEvent(
  grpcClient: GRPCClient,
  event: HMEvent,
  currentAccount?: string,
): Promise<LoadedCitationEvent | null> {
  if (event.newBlob.blobType.toLowerCase() != 'citation') {
    console.error('Event: not a citation event:', event)
    return null
  }

  const mention = event.newBlob.mention
  if (!mention) {
    console.error('Event: citation event missing mention data:', event)
    return null
  }

  try {
    // Determine citation type: 'd' = document reference, 'c' = comment reference
    const citationType =
      mention.sourceType === 'Ref'
        ? 'd'
        : mention.sourceType === 'Comment'
        ? 'c'
        : null
    if (!citationType) return null

    // Parse source ID (the document/comment containing the citation)
    const sourceId = unpackHmId(mention.source)
    if (!sourceId) return null

    // Resolve author
    const author = await resolveAccount(
      grpcClient,
      mention.sourceBlob?.author || '',
      currentAccount,
    )

    // Fetch source document/comment metadata
    let sourceDocument
    if (citationType === 'c' && mention.sourceDocument) {
      // For comments, use sourceDocument field to get the document it's in
      const sourceDocId = unpackHmId(mention.sourceDocument)
      if (sourceDocId) {
        sourceDocument = await grpcClient.documents.getDocument({
          account: sourceDocId.uid,
          path: sourceDocId.path?.length
            ? `/${sourceDocId.path.join('/')}`
            : '',
          version: sourceDocId.version || undefined,
        })
      }
    } else {
      // For documents, use the source directly
      sourceDocument = await grpcClient.documents.getDocument({
        account: sourceId.uid,
        path: sourceId.path?.length ? `/${sourceId.path.join('/')}` : '',
        version: sourceId.version || undefined,
      })
      console.log('=== DOC CITATION', mention)
    }

    // Build source ID with blockRef from sourceContext (the block ID where the citation appears)
    let sourceIdWithBlock: UnpackedHypermediaId
    if (citationType === 'c' && mention.sourceDocument) {
      // For comments, use the sourceDocument as the base
      const sourceDocId = unpackHmId(mention.sourceDocument)!
      sourceIdWithBlock = hmId(sourceDocId.uid, {
        path: sourceDocId.path,
        version: sourceDocId.version,
        blockRef: mention.sourceContext || null, // Block ID where comment appears
      })
    } else {
      // For documents, use the source with sourceContext as blockRef
      sourceIdWithBlock = hmId(sourceId.uid, {
        path: sourceId.path,
        version: sourceId.version,
        blockRef: mention.sourceContext || null, // Block ID where citation appears
      })
    }

    const source: HMContactItem = {
      id: sourceIdWithBlock,
      metadata: sourceDocument?.metadata?.toJson({emitDefaultValues: true}) as
        | HMMetadata
        | undefined,
    }

    // Get the target document ID from extraAttrs (stored in listEventsWithCitationsImpl)
    const targetIdString = event.newBlob.extraAttrs
    const targetId = unpackHmId(targetIdString)
    if (!targetId) {
      console.error('Citation event missing target ID in extraAttrs')
      return null
    }

    // Fetch target document metadata
    const targetDocument = await grpcClient.documents.getDocument({
      account: targetId.uid,
      path: targetId.path?.length ? `/${targetId.path.join('/')}` : '',
      version: mention.targetVersion || undefined,
    })

    const target: HMContactItem = {
      id: hmId(targetId.uid, {
        path: targetId.path,
        version: mention.targetVersion || null,
      }),
      metadata: targetDocument?.metadata?.toJson({emitDefaultValues: true}) as
        | HMMetadata
        | undefined,
    }

    // Generate ID from target + fragment for uniqueness
    const eventId = mention.targetFragment
      ? `${mention.sourceBlob?.cid}-${mention.targetFragment}`
      : mention.sourceBlob?.cid || ''

    // Fetch comment content if this is a comment citation
    let comment: HMComment | null = null
    if (citationType === 'c') {
      try {
        // The comment CID is in mention.sourceBlob.cid
        const commentCid = mention.sourceBlob?.cid
        if (!commentCid) {
          console.error('Citation missing comment CID in sourceBlob')
        } else {
          const grpcComment = await grpcClient.comments.getComment({
            id: commentCid,
          })
          comment = prepareHMComment(grpcComment)
        }
      } catch (error) {
        console.error('Failed to load comment for citation:', error)
        // Continue without comment data rather than failing entirely
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
      targetFragment: mention.targetFragment || undefined,
      comment,
    }
  } catch (error) {
    console.error('Event: catch error loading citation:', event, error)
    return null
  }
}
