import {grpcClient} from '@/grpc-client'
import {
  entityQueryPathToHmIdPath,
  Event,
  HMComment,
  HMDocumentSchema,
  hmId,
  packHmId,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {
  LoadedCapabilityEvent,
  LoadedCommentEvent,
  LoadedContactEvent,
  LoadedDocUpdateEvent,
  LoadedFeedEvent,
} from '@shm/shared/feed-types'
import {loadResource} from '@shm/shared/models/entity'
import {useInfiniteQuery} from '@tanstack/react-query'
import {CID} from 'multiformats/dist/src/cid'
import {loadBlob} from './changes'

async function getMetadata(id: UnpackedHypermediaId) {
  const resource = await grpcClient.resources.getResource({
    iri: id.id,
  })
  if (resource.kind?.case === 'document') {
    const metadata = resource.kind.value.metadata?.toJson()
    return {
      kind: 'document',
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    }
  }
  if (resource.kind?.case === 'comment') {
    return {kind: 'comment'}
  }
  if (resource.kind?.case === 'contact') {
    return {kind: 'contact'}
  }
  return {}
}

async function loadContactEvent(
  event: Event,
): Promise<LoadedContactEvent | null> {
  const {author, cid, resource} = event.data.value || {}
  const {observeTime} = event

  const contactData = cid ? await loadBlob<unknown>(cid) : null
  if (!author) return null
  if (!resource) return null
  const authorId = hmId(author)
  const resourceId = unpackHmId(resource)
  if (!resourceId) return null
  return {
    type: 'contact',
    time: observeTime || {seconds: 0, nanos: 0},
    author: {
      id: authorId,
      metadata: await getMetadata(authorId),
    },
    contact: {
      id: resourceId,
      metadata: await getMetadata(resourceId),
    },
    id: resourceId.uid,
  }
}

async function loadCapabilityEvent(
  event: Event,
): Promise<LoadedCapabilityEvent | null> {
  const {author, resource} = event.data.value || {}
  const {observeTime, data: caapabilityBlob} = event
  const newBlob = event.data.case === 'newBlob' ? event.data.value : null
  const {blobType, cid} = newBlob || {}

  if (!author || !resource) {
    return null
  }

  const authorId = hmId(author)
  const resourceId = unpackHmId(resource)

  if (!resourceId) {
    console.error('loadCapabilityEvent Error, unpacking resource id', resource)
    return null
  }

  // first get the capability blob
  const capabilityBlob = cid ? await loadBlob<unknown>(cid) : null
  if (!capabilityBlob) {
    console.error('loadCapabilityEvent Error, loading capability blob', cid)
    return null
  }

  // For now, create a basic capability event until we have proper capability loading
  return {
    id: resourceId.uid,
    type: 'capability',
    author: {
      id: authorId,
      metadata: await getMetadata(authorId),
    },
    targetId: null,
    targetMetadata: null,
    time: observeTime || {seconds: 0, nanos: 0},
    delegates: [], // TODO: Load actual delegates when capability loading is implemented
    capabilityId: resourceId,
    capability: {
      // TODO: Load actual capability data
      kind: 'unknown',
      target: resource,
    } as any, // Temporary type assertion until proper capability schema is available
  }
}

async function loadCommentEvent(
  event: Event,
): Promise<LoadedCommentEvent | null> {
  const {author, resource} = event.data.value || {}
  const {observeTime} = event

  const resourceId = unpackHmId(resource)
  const resourceData = resourceId ? await loadResource(resourceId) : null

  const comment: HMComment | null =
    resourceData?.type === 'comment' && resourceData.comment
      ? resourceData.comment
      : null
  const targetId = comment?.targetAccount
    ? hmId(comment?.targetAccount, {
        path: entityQueryPathToHmIdPath(comment.targetPath),
        version: comment.targetVersion,
      })
    : null
  const targetMetadata = targetId ? await getMetadata(targetId) : null

  if (!author) return null
  if (!resource) return null
  const authorId = hmId(author)
  if (!resourceId) return null
  return {
    id: resourceId.uid,
    type: 'comment',
    time: observeTime || {seconds: 0, nanos: 0},
    author: {
      id: authorId,
      metadata: await getMetadata(authorId),
    },
    comment,
    commentId: resourceId,
    targetMetadata: targetMetadata ?? null,
    targetId: targetId ?? null,
    replyingComment: null,
    replyingAuthor: null,
    // targetMetadata: await getMetadata(resourceId),
    // targetId: resourceId,
  }
}

async function loadDocUpdateEvent(
  event: Event,
): Promise<LoadedDocUpdateEvent | null> {
  const {author, cid, resource} = event.data.value || {}
  if (!cid) return null
  const refData = cid
    ? await loadBlob<{
        heads: CID[]
        ts: number
      }>(cid)
    : null
  const docId = unpackHmId(resource)
  if (!refData) return null
  if (!docId) return null
  if (!author) return null
  const authorId = hmId(author)
  const docVersion = refData.heads.map((c: CID) => c.toString()).join('.')
  const exactDocId = hmId(docId.uid, {path: docId.path, version: docVersion})
  const docResource = await grpcClient.resources.getResource({
    iri: packHmId(exactDocId),
  })
  if (docResource.kind?.case !== 'document') {
    return null
  }
  // const docResourceMetadata = docResource.kind.value.metadata?.toJson()
  return {
    id: cid,
    type: 'doc-update',
    time: toHMTimestamp(refData.ts),
    docId: exactDocId,
    document: HMDocumentSchema.parse(docResource.kind.value.toJson()),
    author: {
      id: authorId,
      metadata: await getMetadata(authorId),
    },
  }
}

function toHMTimestamp(ts: number) {
  return {
    seconds: Math.floor(ts / 1000),
    nanos: (ts % 1000) * 1000000,
  }
}

async function loadEvent(event: Event): Promise<LoadedFeedEvent | null> {
  const blobType =
    event.data.case === 'newBlob' ? event.data.value.blobType : undefined

  try {
    switch (blobType) {
      case 'Contact':
        return await loadContactEvent(event)
      case 'Capability':
        return await loadCapabilityEvent(event)
      case 'Comment':
        return await loadCommentEvent(event)
      case 'Ref':
        return await loadDocUpdateEvent(event)
      default:
        return null
    }
  } catch (error) {
    console.error('Error loading event:', error)
    return null
  }
}

export function useDocFeed(docId: UnpackedHypermediaId) {
  return useInfiniteQuery(
    [queryKeys.FEED, docId.id],
    async ({pageParam}) => {
      const feedResp = await grpcClient.activityFeed.listEvents({
        filterResource: `${docId.id}*`,
        pageSize: 5,
        pageToken: pageParam,
      })

      const loadedEvents: LoadedFeedEvent[] = []

      for (const event of feedResp.events) {
        const loaded = await loadEvent(event)
        if (loaded) {
          loadedEvents.push(loaded)
        }
      }

      return {
        events: loadedEvents,
        nextPageToken: feedResp.nextPageToken,
      }
    },
    {
      getNextPageParam: (lastPage, allPages) => {
        const next = lastPage.nextPageToken
        return next || undefined
      },
    },
  )
}
