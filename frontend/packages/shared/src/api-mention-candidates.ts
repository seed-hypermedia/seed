import type {HMMentionCandidate, HMMentionCandidatesRequest} from '@seed-hypermedia/client/hm-types'
import {Code, ConnectError} from '@connectrpc/connect'
import {loadAccount} from './api-account'
import {EntityKindFilter} from './client/.generated/entities/v1alpha/entities_pb'
import type {HMRequestImplementation} from './api-types'
import type {GRPCClient} from './grpc-client'
import {Role} from './client/.generated/documents/v3alpha/access_control_pb'
import {FeedOrder} from './client/.generated/activity/v1alpha/activity_pb'
import {hmId, unpackHmId} from './utils/entity-id-url'
import {entityQueryPathToHmIdPath, hmIdPathToEntityQueryPath} from './utils/path-api'

const LIMIT = 100
const caches = new WeakMap<GRPCClient, Map<string, {expires: number; value: Promise<unknown>}>>()

// Public metadata and graph lookups are reused across queries, but never across daemon clients.
function cached<T>(client: GRPCClient, key: string, get: () => Promise<T>, retainVerifiedHead = false): Promise<T> {
  let cache = caches.get(client)
  if (!cache) {
    cache = new Map()
    caches.set(client, cache)
  }
  const existing = cache.get(key)
  if (existing && existing.expires > Date.now()) return existing.value as Promise<T>
  if (cache.size > 500) cache.clear()
  const value = get().catch((error) => {
    if (
      retainVerifiedHead &&
      existing &&
      error instanceof ConnectError &&
      (error.code === Code.Unavailable || error.code === Code.DeadlineExceeded)
    ) {
      return existing.value as Promise<T>
    }
    cache.delete(key)
    throw error
  })
  cache.set(key, {expires: Date.now() + 15_000, value})
  return value
}

/** Mode-specific bounded mention discovery, using raw search types and current published heads. */
export const MentionCandidates: HMRequestImplementation<HMMentionCandidatesRequest> = {
  async getData(client, input) {
    const query = input.query.trim()
    const [search, contacts, members, capabilities, events, directory, knownAccounts] = await Promise.all([
      query
        ? client.entities.searchEntities({
            query,
            loggedAccountUid: input.perspectiveAccountUid,
            includeBody: false,
            pageSize: LIMIT,
            entityKindFilter:
              input.mode === 'account'
                ? [EntityKindFilter.ENTITY_KIND_SPACE, EntityKindFilter.ENTITY_KIND_CONTACT]
                : [EntityKindFilter.ENTITY_KIND_SPACE, EntityKindFilter.ENTITY_KIND_DOCUMENT],
          })
        : undefined,
      input.perspectiveAccountUid
        ? client.documents
            .listContacts({filter: {case: 'account', value: input.perspectiveAccountUid}, pageSize: LIMIT})
            .catch(() => undefined)
        : undefined,
      input.siteUid
        ? cached(client, `members:${input.siteUid}`, () =>
            client.documents.listContacts({filter: {case: 'subject', value: input.siteUid!}, pageSize: LIMIT}),
          ).catch(() => undefined)
        : undefined,
      input.siteUid
        ? cached(client, `caps:${input.siteUid}:${input.documentId?.path?.join('/') || ''}`, () =>
            client.accessControl.listCapabilities({
              account: input.siteUid!,
              path: hmIdPathToEntityQueryPath(input.documentId?.path ?? null),
              pageSize: LIMIT,
            }),
          ).catch(() => undefined)
        : undefined,
      cached(client, 'mention-activity', () =>
        client.activityFeed.listEvents({
          pageSize: LIMIT,
          filterEventType: ['Ref', 'Comment'],
          order: FeedOrder.CLAIMED_TIME,
        }),
      ).catch(() => undefined),
      input.mode === 'document'
        ? cached(client, `mention-documents:${input.siteUid || ''}`, () =>
            client.documents.listDocuments({account: input.siteUid, pageSize: LIMIT}),
          ).catch(() => undefined)
        : undefined,
      input.mode === 'account' && !query
        ? cached(client, 'mention-known-accounts', () => client.documents.listAccounts({pageSize: LIMIT})).catch(
            () => undefined,
          )
        : undefined,
    ])
    const contactNames = new Map(contacts?.contacts.map((c) => [c.subject, c.name]))
    // Search can find a matching issued contact beyond the bounded first contacts page.
    if (input.perspectiveAccountUid)
      search?.entities.forEach((entity) => {
        if (entity.type !== 'contact') return
        const id = unpackHmId(entity.id)
        if (id && !contactNames.has(id.uid)) contactNames.set(id.uid, entity.content)
      })
    const accountRoles = new Map<string, NonNullable<HMMentionCandidate['accountRole']>>()
    if (input.siteUid) accountRoles.set(input.siteUid, 'site-owner')
    members?.contacts.forEach((c) => {
      if ((c.metadata?.toJson() as {subscribe?: {site?: boolean}})?.subscribe?.site && !accountRoles.has(c.account))
        accountRoles.set(c.account, 'site-follower')
    })
    capabilities?.capabilities.forEach((c) => {
      if (c.role !== Role.WRITER) return
      const current = accountRoles.get(c.delegate)
      if (current === 'site-owner' || current === 'site-editor') return
      accountRoles.set(c.delegate, c.path || c.isExact ? 'document-editor' : 'site-editor')
    })
    const siteMembers = new Set(accountRoles.keys())
    const activity = new Map<string, {time: number; type: 'publication' | 'comment'}>()
    const ids = new Map<string, ReturnType<typeof hmId>>()
    const add = (id: ReturnType<typeof hmId>) => {
      const key = input.mode === 'account' ? id.uid : `${id.uid}:${JSON.stringify(id.path || [])}`
      if (!ids.has(key)) ids.set(key, id)
    }
    // Matches enter the bounded pool before contextual candidates.
    search?.entities.forEach((entity) => {
      const id = unpackHmId(entity.id)
      if (!id) return
      if (
        input.mode === 'account' &&
        (entity.type === 'profile' || entity.type === 'contact' || (!id.path?.length && entity.type === 'title'))
      )
        add(hmId(id.uid))
      if (input.mode === 'document' && ['document', 'title', 'profile'].includes(entity.type))
        add(hmId(id.uid, {path: id.path}))
    })
    input.seedIds?.slice(0, 20).forEach((id) => {
      add(id)
    })
    if (input.mode === 'account') {
      contactNames.forEach((_name, uid) => add(hmId(uid)))
      siteMembers.forEach((uid) => add(hmId(uid)))
    }
    events?.events.forEach((event) => {
      if (event.data.case !== 'newBlob') return
      const blob = event.data.value
      if (blob.blobType !== 'Ref' && blob.blobType !== 'Comment') return
      const author = event.account || blob.author
      const time = event.eventTime?.toDate().getTime()
      if (author && time !== undefined && (!activity.has(author) || activity.get(author)!.time < time))
        activity.set(author, {time, type: blob.blobType === 'Comment' ? 'comment' : 'publication'})
      if (input.mode === 'account' && author) add(hmId(author))
      if (input.mode === 'document' && blob.blobType === 'Ref') {
        const id = unpackHmId(blob.resource)
        if (id) add(id)
      }
    })
    directory?.documents.forEach((doc) => add(hmId(doc.account, {path: entityQueryPathToHmIdPath(doc.path)})))
    knownAccounts?.accounts.forEach((account) => add(hmId(account.id)))
    // Interleave contextual sources so a large following list cannot exclude activity/site seeds.
    const matching = new Set(
      search?.entities.map((e) => unpackHmId(e.id)?.uid + ':' + JSON.stringify(unpackHmId(e.id)?.path || [])),
    )
    const all = Array.from(ids.values())
    const groups = [
      all.filter((id) => matching.has(id.uid + ':' + JSON.stringify(id.path || []))),
      all.filter(
        (id) =>
          input.seedIds?.some(
            (seed) =>
              seed.uid === id.uid &&
              (input.mode === 'account' || JSON.stringify(seed.path || []) === JSON.stringify(id.path || [])),
          ),
      ),
      all
        .filter((id) => contactNames.has(id.uid))
        .sort(
          (a, b) =>
            Number(contactNames.get(b.uid)?.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) -
            Number(contactNames.get(a.uid)?.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())),
        ),
      all.filter((id) => siteMembers.has(id.uid) || id.uid === input.siteUid),
      all.filter((id) => activity.has(id.uid)),
      all,
    ]
    const selected = new Map<string, ReturnType<typeof hmId>>()
    for (let round = 0; round < LIMIT && selected.size < LIMIT; round++) {
      for (const group of groups) {
        const id = group[round]
        if (id && selected.size < LIMIT) selected.set(input.mode === 'account' ? id.uid : id.id, id)
      }
    }
    const pending = Array.from(selected.values())
    const results: HMMentionCandidate[] = []
    let index = 0
    await Promise.all(
      Array.from({length: Math.min(8, pending.length)}, async () => {
        while (index < pending.length) {
          const id = pending[index++]!
          try {
            if (input.mode === 'account') {
              const account = await cached(client, `account:${id.uid}`, () => loadAccount(client, id.uid))
              if (account.type !== 'account') continue
              const uid = account.id.uid
              const metadata = account.metadata || {}
              const petname = contactNames.get(uid) ?? contactNames.get(id.uid)
              const recentActivity = await cached(client, `mention-activity:${uid}`, () =>
                client.activityFeed.listEvents({
                  pageSize: 1,
                  filterAuthors: [uid],
                  filterEventType: ['Ref', 'Comment'],
                  order: FeedOrder.CLAIMED_TIME,
                }),
              ).catch(() => undefined)
              const recentEvent = recentActivity?.events[0]
              if (recentEvent?.eventTime && recentEvent.data.case === 'newBlob')
                activity.set(uid, {
                  time: recentEvent.eventTime.toDate().getTime(),
                  type: recentEvent.data.value.blobType === 'Comment' ? 'comment' : 'publication',
                })
              results.push({
                id: hmId(uid),
                type: 'account',
                sourceAccountUid: id.uid,
                title: petname || metadata.name || uid,
                publicName: metadata.name,
                petname,
                icon: metadata.icon || '',
                parentNames: [],
                searchQuery: query,
                sameSite: siteMembers.has(uid) || siteMembers.has(id.uid),
                accountRole: accountRoles.get(uid) ?? accountRoles.get(id.uid),
                issuedContact: contactNames.has(uid) || contactNames.has(id.uid),
                activityTime: activity.get(uid)?.time,
                activityType: activity.get(uid)?.type,
              })
            } else {
              const doc = await cached(
                client,
                `document:${id.uid}:${JSON.stringify(id.path || [])}`,
                () => client.documents.getDocumentInfo({account: id.uid, path: hmIdPathToEntityQueryPath(id.path)}),
                true,
              )
              if (!doc.version) continue
              const metadata = doc.metadata?.toJson() as {name?: string; icon?: string} | undefined
              results.push({
                id: hmId(doc.account, {path: entityQueryPathToHmIdPath(doc.path), version: doc.version, latest: true}),
                type: 'document',
                title: metadata?.name || doc.path || 'Home document',
                icon: metadata?.icon || '',
                parentNames: [doc.account, ...(id.path || []).slice(0, -1)],
                searchQuery: query,
                sameSite: doc.account === input.siteUid,
                issuedContact: false,
                activityTime: doc.updateTime?.toDate().getTime() ?? doc.createTime?.toDate().getTime(),
                activityType: 'publication',
              })
            }
          } catch {
            // An unavailable or unpublished target must never become a different mention kind.
          }
        }
      }),
    )
    return results
  },
}
