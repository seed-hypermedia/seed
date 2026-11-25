import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMListEventsRequest, HMRawCitation} from '@seed-hypermedia/client/hm-types'
import {FeedOrder} from './client/.generated/activity/v1alpha/activity_pb'
import {Mention} from './client/.generated/entities/v1alpha/entities_pb'
import {LIST_PAGE_SIZE} from './list-all-pages'
import {parseFragment} from './utils'
import {
  getEventAtMs,
  getFeedEventId,
  getEventType,
  HMActivityEvent,
  listEventsImpl,
  loadCapabilityEvent,
  loadCitationEvent,
  loadCommentEvent,
  loadContactEvent,
  LoadedEvent,
  LoadedEventWithNotifMeta,
  loadRefEvent,
} from './models/activity-service'
import {createRequestCache, RequestCache} from './request-cache'

async function resolveEvent(
  grpcClient: GRPCClient,
  event: HMActivityEvent,
  currentAccount: string | undefined,
  cache: RequestCache,
): Promise<LoadedEventWithNotifMeta | null> {
  try {
    const eventType = getEventType(event)

    if (!eventType) {
      console.error('Unable to determine event type:', event)
      return null
    }

    let resolvedEvent: LoadedEvent | null = null
    switch (eventType) {
      case 'comment':
        resolvedEvent = await loadCommentEvent(grpcClient, event, currentAccount, cache)
        break
      case 'ref':
        resolvedEvent = await loadRefEvent(grpcClient, event, currentAccount, cache)
        break
      case 'capability':
        resolvedEvent = await loadCapabilityEvent(grpcClient, event, currentAccount, cache)
        break
      case 'contact':
        resolvedEvent = await loadContactEvent(grpcClient, event, currentAccount, cache)
        break
      case 'citation':
      case 'comment/target':
      case 'comment/embed':
      case 'comment/link':
      case 'doc/target':
      case 'doc/embed':
      case 'doc/link':
      case 'doc/button':
        resolvedEvent = await loadCitationEvent(grpcClient, event, currentAccount, cache)
        break
      case 'dagpb':
      case 'profile':
        return null
      default:
        console.warn(`Unknown event type: ${eventType}`)
        return null
    }

    if (!resolvedEvent) return null

    const feedEventId = getFeedEventId(event)
    if (!feedEventId) {
      console.warn('Missing feedEventId for event:', event)
      return null
    }

    return {
      ...resolvedEvent,
      feedEventId,
      eventAtMs: getEventAtMs(event),
    }
  } catch (error) {
    console.error('Error resolving event:', event, error)
    return null
  }
}

/**
 * The citations panel of one block, one entry per citing block. The feed keeps one event per
 * publication, so a document that links one block from many places (a paper citing its bibliography)
 * has at most one of them there, usually for another block. ListCitations returns one row per citing
 * block, so the panel reads one page of it (LIST_PAGE_SIZE, like every citation list), keeps the
 * document citations of the block and resolves them the way feed events are resolved. No next page.
 */
export async function listBlockCitationEvents(
  grpcClient: GRPCClient,
  input: {filterResource: string; targetBlockId: string; currentAccount?: string},
  cache: RequestCache,
): Promise<HMListEventsRequest['output']> {
  const page = await grpcClient.resources.listCitations({iri: input.filterResource, pageSize: LIST_PAGE_SIZE})
  const rows = page.citations
    .map((c) => c.toJson({emitDefaultValues: true, enumAsInteger: false}) as unknown as HMRawCitation)
    .filter((c) => c.sourceType === 'Ref' && parseFragment(c.targetFragment ?? null)?.blockId === input.targetBlockId)
  const resolved = await Promise.allSettled(
    rows.map(async (c): Promise<LoadedEventWithNotifMeta | null> => {
      const event: HMActivityEvent = {
        account: c.sourceBlob?.author ?? '',
        eventTime: c.sourceBlob?.createTime ?? null,
        observeTime: null,
        // sourceBlob.cid stays empty on purpose: for a document citation it is the Ref blob, which is
        // not a document version, and the loader would read it as one.
        newMention: {
          source: c.source,
          sourceType: c.citationType || 'doc/Link',
          sourceContext: c.sourceContext ?? '',
          sourceBlob: {cid: '', author: c.sourceBlob?.author ?? '', createTime: c.sourceBlob?.createTime},
          isExactVersion: c.isExactVersion ?? false,
          sourceDocument: c.sourceDocument ?? '',
          target: c.target || input.filterResource,
          targetVersion: c.targetVersion ?? '',
          targetFragment: c.targetFragment ?? '',
        } as unknown as Mention,
      }
      const loaded = await loadCitationEvent(grpcClient, event, input.currentAccount, cache)
      if (!loaded) return null
      // The loader keys the event on the source blob, which these rows share; key it on the citing block.
      const key = `${c.source}#${c.sourceContext}-${c.targetFragment}`
      return {...loaded, id: key, feedEventId: `citation-${key}`, eventAtMs: getEventAtMs(event)}
    }),
  )
  const events = resolved
    .filter((r): r is PromiseFulfilledResult<LoadedEventWithNotifMeta> => r.status === 'fulfilled' && !!r.value)
    .map((r) => r.value)
    .sort((a, b) => b.eventAtMs - a.eventAtMs)
  return {events, nextPageToken: ''}
}

export const ListEvents: HMRequestImplementation<HMListEventsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    if (input.targetBlockId && input.filterResource) {
      return listBlockCitationEvents(
        grpcClient,
        {
          filterResource: input.filterResource,
          targetBlockId: input.targetBlockId,
          currentAccount: input.currentAccount,
        },
        createRequestCache(grpcClient),
      )
    }

    // Get raw events from gRPC. Map the wire `order` string to the gRPC FeedOrder enum.
    const order = input.order === 'observed' ? FeedOrder.OBSERVED_TIME : FeedOrder.CLAIMED_TIME
    const response = await listEventsImpl(grpcClient, {...input, order})

    // Create request-scoped cache to deduplicate resource fetches
    // This ensures that if multiple events reference the same account/document/comment,
    // only one gRPC call is made for each unique resource
    const cache = createRequestCache(grpcClient)

    // Resolve all events server-side
    const resolvedEvents = await Promise.allSettled(
      response.events.map((event) => resolveEvent(grpcClient, event, input.currentAccount, cache)),
    )

    // Filter out failed promises and null values
    const events = resolvedEvents
      .filter((result) => result.status === 'fulfilled' && result.value)
      .map((result) => (result as PromiseFulfilledResult<LoadedEvent>).value)

    return {
      events,
      nextPageToken: response.nextPageToken,
    }
  },
}
