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
  replyingAuthor: HMContactItem | null
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
      "Ref",
      "Capability", 
      "Comment",
      "DagPB",
      "Profile",
      "Contact",
      // "comment/Target",
      "comment/Embed", 
      "doc/Embed",
      "doc/Link",
      "doc/Button"
    ],
    filterResource: params.filterResource || '',
  })

  

  let res = response.toJson({
    emitDefaultValues: true,
  }) as unknown as HMListEventsResponse

  console.log(`== ~ listEventsImpl ~ res:`, res)

  return res
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
      replyingAuthor,
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

  console.log('=== CITATION-EVENT', event)
  const blobType = event.newBlob.blobType.toLowerCase()
  const validCitationTypes = [
    'citation',
    'comment/target',
    'comment/embed',
    'comment/link',
    'doc/embed',
    'doc/link',
    'doc/button',
  ]

  if (!validCitationTypes.includes(blobType)) {
    console.error('Event: not a citation event:', event)
    return null
  }



  const mention = event.newBlob.mention
  if (!mention) {
    // If the Activity API hasn't populated the mention field yet,
    // we need to fetch it manually using listEntityMentions
    console.warn('Citation event missing mention data, attempting to fetch:', {
      blobType: event.newBlob.blobType,
      cid: event.newBlob.cid,
    })

    // Try to extract target from extraAttrs
    let targetId: string | null = null
    try {
      const extraAttrs = JSON.parse(event.newBlob.extraAttrs)
      if (extraAttrs.tsid) {
        // Construct target ID from resource author + tsid
        const resourceId = unpackHmId(event.newBlob.resource)
        if (resourceId) {
          targetId = `hm://${resourceId.uid}/${extraAttrs.tsid}`
        }
      }
    } catch (e) {
      console.error('Failed to parse extraAttrs for citation:', e)
    }

    if (!targetId) {
      console.error('Cannot resolve citation without target ID', {
        resource: event.newBlob.resource,
        extraAttrs: event.newBlob.extraAttrs,
      })
      return null
    }

    // Fetch mentions for this target to find the matching citation
    try {
      console.log('Fetching mentions for target:', targetId)
      const mentionsResponse = await grpcClient.entities.listEntityMentions({
        id: targetId,
        pageSize: 100,
        reverseOrder: true,
      })

      // Find the mention that matches this event's CID
      const matchingMention = mentionsResponse.mentions.find(
        (m) => m.sourceBlob?.cid === event.newBlob.cid
      )

      if (!matchingMention) {
        console.error('Could not find matching mention for citation event:', event.newBlob.cid)
        return null
      }

      // Attach the mention to the event for processing below
      event.newBlob.mention = matchingMention
    } catch (e) {
      console.error('Failed to fetch mentions for citation:', e)
      return null
    }
  }

  // At this point, mention should be populated (either from API or fetched manually)
  const citationMention = event.newBlob.mention!

  try {
    // Determine citation type: 'd' = document reference, 'c' = comment reference
    const citationType =
      citationMention.sourceType === 'Ref'
        ? 'd'
        : citationMention.sourceType === 'Comment'
        ? 'c'
        : null
    if (!citationType) return null

    // Parse source ID (the document/comment containing the citation)
    const sourceId = unpackHmId(citationMention.source)
    if (!sourceId) return null

    // Resolve author
    const author = await resolveAccount(
      grpcClient,
      citationMention.sourceBlob?.author || '',
      currentAccount,
    )

    // Fetch source document/comment metadata
    let sourceDocument
    if (citationType === 'c' && citationMention.sourceDocument) {
      // For comments, use sourceDocument field to get the document it's in
      const sourceDocId = unpackHmId(citationMention.sourceDocument)
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
    }

    // Build source ID with blockRef from sourceContext (the block ID where the citation appears)
    let sourceIdWithBlock: UnpackedHypermediaId
    if (citationType === 'c' && citationMention.sourceDocument) {
      // For comments, use the sourceDocument as the base
      const sourceDocId = unpackHmId(citationMention.sourceDocument)!
      sourceIdWithBlock = hmId(sourceDocId.uid, {
        path: sourceDocId.path,
        version: sourceDocId.version,
        blockRef: citationMention.sourceContext || null, // Block ID where comment appears
      })
    } else {
      // For documents, use the source with sourceContext as blockRef
      sourceIdWithBlock = hmId(sourceId.uid, {
        path: sourceId.path,
        version: sourceId.version,
        blockRef: citationMention.sourceContext || null, // Block ID where citation appears
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
      version: citationMention.targetVersion || undefined,
    })

    const target: HMContactItem = {
      id: hmId(targetId.uid, {
        path: targetId.path,
        version: citationMention.targetVersion || null,
      }),
      metadata: targetDocument?.metadata?.toJson({emitDefaultValues: true}) as
        | HMMetadata
        | undefined,
    }

    // Generate ID from target + fragment for uniqueness
    const eventId = citationMention.targetFragment
      ? `${citationMention.sourceBlob?.cid}-${citationMention.targetFragment}`
      : citationMention.sourceBlob?.cid || ''

    // Fetch comment content if this is a comment citation
    let comment: HMComment | null = null
    let replyCount: number | undefined = undefined
    if (citationType === 'c') {
      try {
        // The comment CID is in citationMention.sourceBlob.cid
        const commentCid = citationMention.sourceBlob?.cid
        if (!commentCid) {
          console.error('Citation missing comment CID in sourceBlob')
        } else {
          const grpcComment = await grpcClient.comments.getComment({
            id: commentCid,
          })
          comment = prepareHMComment(grpcComment)

          // Fetch reply count for the comment
          const replyCountResponse =
            await grpcClient.comments.getCommentReplyCount({
              id: commentCid,
            })
          replyCount = Number(replyCountResponse.replyCount)
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
      targetFragment: citationMention.targetFragment || undefined,
      comment,
      replyCount,
    }
  } catch (error) {
    console.error('Event: catch error loading citation:', event, error)
    return null
  }
}

