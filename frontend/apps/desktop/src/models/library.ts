import {useGRPCClient} from '@/app-context'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  BIG_INT,
  entityQueryPathToHmIdPath,
  HMAccount,
  HMComment,
  HMDocument,
  HMDocumentInfo,
  HMDraft,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useQuery} from '@tanstack/react-query'
import {useAccounts, useDrafts} from './accounts'
import {useComments} from './comments'
import {useDraftList} from './documents'
import {getParentPaths, useEntities} from './entities'
import {useFavorites} from './favorites'
import {useSearch} from './search'
import {HMSubscription, useListSubscriptions} from './subscription'

export type FilterItem =
  | 'owner'
  | 'admin'
  | 'editor'
  | 'writer'
  | 'drafts'
  | 'subscribed'
  | 'favorites'

export type LibraryQueryState = {
  sort: 'lastUpdate' | 'alphabetical'
  display: 'cards' | 'list'
  filterString: string
  filter: Partial<Record<FilterItem, boolean>>
}
export type LibraryDependentData = {
  id: UnpackedHypermediaId
  metadata?: HMMetadata
}
export type LibraryData = {
  items: Array<{
    id: UnpackedHypermediaId
    document?: HMDocument
    hasDraft: boolean
    draft?: HMDraft
    location: LibraryDependentData[]
    authors: LibraryDependentData[]
    isFavorite: boolean
    isSubscribed: boolean
  }>
  totalItemCount: number
}

function isSubscribedBy(
  id: UnpackedHypermediaId,
  sub: HMSubscription,
): boolean {
  if (sub.id.uid !== id.uid) return false
  if (!id.path || !sub.id.path) return false
  const subPath = sub.id.path.join('/')
  const idPath = id.path.join('/')
  if (subPath === idPath) return true
  if (!sub.recursive) return false
  if (idPath.startsWith(subPath)) return true
  return false
}

export type ClassicLibrarySite = {
  entityUid: string
  items: HMDocumentInfo[]
  homeItem: HMDocumentInfo | null
}

export type AccountsMetadata = Record<string, HMMetadataPayload>

export type LibrarySite = HMAccount & {
  type: 'site'
  latestComment?: HMComment | null
}

export type LibraryDocument = HMDocumentInfo & {
  type: 'document'
  latestComment?: HMComment | null
}
export type LibraryItem = LibrarySite | LibraryDocument

export function useLibrary({
  grouping,
  displayMode,
}: {
  grouping: 'site' | 'none'
  displayMode: 'all' | 'subscribed' | 'favorites'
}) {
  const accounts = useAccounts()
  const favorites = useFavorites()
  const subscriptions = useListSubscriptions()
  const allDocuments = useAllDocuments(grouping === 'none')
  const commentIds =
    grouping === 'none'
      ? allDocuments.data
          ?.map((doc) => doc.activitySummary?.latestCommentId)
          .filter((commentId) => commentId != null)
          .filter((commentId) => commentId.length)
      : accounts.data?.accounts
          .map((account) => account.activitySummary?.latestCommentId)
          .filter((commentId) => commentId != null)
          .filter((commentId) => commentId.length)
  const comments = useComments(commentIds || [])
  let items: undefined | LibraryItem[]
  if (grouping === 'none') {
    let documents = allDocuments.data
    if (displayMode === 'subscribed') {
      documents = documents?.filter(
        (doc) =>
          subscriptions.data?.find((sub) =>
            isSubscribedBy(
              hmId('d', doc.account, {
                path: doc.path,
              }),
              sub,
            ),
          ),
      )
    } else if (displayMode === 'favorites') {
      documents = documents?.filter(
        (doc) =>
          favorites?.find((fav) => {
            console.log('filter.. doc.path', doc.path)
            return (
              fav &&
              fav.id ===
                hmId('d', doc.account, {
                  path: entityQueryPathToHmIdPath(doc.path),
                }).id
            )
          }),
      )
    }
    items = documents?.map((doc) => ({
      ...doc,
      type: 'document',
      latestComment: doc.activitySummary?.latestCommentId
        ? comments.find(
            (c) => c.data?.id === doc.activitySummary?.latestCommentId,
          )?.data
        : undefined,
    }))
  } else {
    let accts = accounts.data?.accounts
    if (displayMode === 'subscribed') {
      accts = accts?.filter(
        (acct) => subscriptions.data?.find((sub) => sub.account === acct.id),
      )
    } else if (displayMode === 'favorites') {
      accts = accts?.filter(
        (acct) => favorites?.find((fav) => fav && fav.uid === acct.id),
      )
    }
    items = accts?.map((account) => {
      return {
        ...account,
        type: 'site',
        latestComment: account.activitySummary?.latestCommentId
          ? comments.find(
              (c) => c.data?.id === account.activitySummary?.latestCommentId,
            )?.data
          : undefined,
      }
    })
  }
  return {
    items,
    accounts: accounts.data?.accounts,
    accountsMetadata: accounts.data?.accountsMetadata,
  }
}

function useAllDocuments(enabled: boolean) {
  const grpcClient = useGRPCClient()
  const allDocuments = useQuery({
    queryKey: [queryKeys.LIBRARY],
    enabled,
    queryFn: async () => {
      const res = await grpcClient.documents.listDocuments({
        pageSize: BIG_INT,
      })
      return toPlainMessage(res).documents.map((docInfo) => {
        return {
          ...docInfo,
          type: 'document',
          path: entityQueryPathToHmIdPath(docInfo.path),
        } as HMDocumentInfo
      })
    },
  })
  return allDocuments
}

export function useSiteLibrary(
  siteUid: string,
  enabled: boolean,
): {data: LibraryDocument[] | undefined} {
  const grpcClient = useGRPCClient()
  const siteDocuments = useQuery({
    queryKey: [queryKeys.SITE_LIBRARY, siteUid],
    enabled,
    queryFn: async () => {
      const res = await grpcClient.documents.listDocuments({
        account: siteUid,
        pageSize: BIG_INT,
      })
      return {
        documents: toPlainMessage(res).documents,
      }
    },
  })
  const commentIds = siteDocuments.data?.documents
    .map((doc) => doc.activitySummary?.latestCommentId)
    .filter((commentId) => commentId != null)
    .filter((commentId) => commentId.length)
  const comments = useComments(commentIds || [])

  return {
    ...siteDocuments,
    data: siteDocuments.data?.documents.map((doc) => ({
      ...doc,
      path: entityQueryPathToHmIdPath(doc.path),
      type: 'document',
      latestComment: comments.find(
        (c) => c.data?.id === doc.activitySummary?.latestCommentId,
      )?.data,
    })),
  }
}

export function useChildrenActivity(docId: UnpackedHypermediaId) {
  const siteLibrary = useSiteLibrary(docId.uid, true)
  const path = docId.path
  const pathPrefix = docId.path?.join('/') || ''
  return {
    ...siteLibrary,
    data: siteLibrary.data?.filter((item) => {
      if (!item.path?.length) return false
      if (item.path.length !== (path?.length || 0) + 1) return false
      const pathStr = item.path.join('/')
      if (!pathStr.startsWith(pathPrefix)) return false
      return true
    }),
  }
}

export function useClassicLibrary(
  query: LibraryQueryState,
): LibraryData | null {
  const search = useSearch(query.filterString, {})
  const favorites = useFavorites()
  const subscriptions = useListSubscriptions()
  const draftList = useDraftList()
  const searchedIds =
    search.data?.map((entity) => unpackHmId(entity.id)).filter((id) => !!id) ||
    []
  const draftQueryList = draftList.data?.filter(
    (draftId) =>
      search.data?.findIndex((searchResult) => searchResult.id === draftId) ===
      -1,
  )
  const selectedFilters = Object.entries(query.filter)
    .filter(([filterKey, value]) => value)
    .map(([filterKey]) => filterKey as FilterItem)
  const entities = useEntities(searchedIds)
  const alreadyFetchingIds = new Set<string>()
  searchedIds.forEach((id) => {
    alreadyFetchingIds.add(id.id)
  })
  const dependentEntityIds: UnpackedHypermediaId[] = []
  function dependOnId(id: UnpackedHypermediaId) {
    if (alreadyFetchingIds.has(id.id)) return
    dependentEntityIds.push(id)
    alreadyFetchingIds.add(id.id)
  }
  entities.forEach((entity) => {
    // depend on published doc authors
    entity.data?.document?.authors?.forEach((authorUid) => {
      const id = hmId('d', authorUid)
      dependOnId(id)
    })
    const entityId = entity.data?.id
    if (!entityId) return
    // depend on published doc locations
    getParentPaths(entityId.path)
      .slice(0, -1)
      .forEach((path) => {
        dependOnId(hmId('d', entityId.uid, {path}))
      })
  })
  const drafts = useDrafts(draftQueryList || [])
  drafts // depend on signing accounts for drafts
    .map((draft) => draft.data?.signingAccount)
    .forEach((accountUid) => {
      if (!accountUid) return
      const id = hmId('d', accountUid)
      dependOnId(id)
    })
  draftQueryList?.map((draftIdString) => {
    const draftId = unpackHmId(draftIdString)
    if (!draftId) return
    if (draftId.type !== 'd') return
    // depend on draft locations
    getParentPaths(draftId.path)
      .slice(0, -1)
      .forEach((path) => {
        dependOnId(hmId('d', draftId.uid, {path}))
      })
  })
  function getAuthors(authorUids: string[]): LibraryDependentData[] {
    return authorUids
      .map((authorUid) => {
        if (!authorUid) return undefined
        const e = entities.find(
          (entity) =>
            entity.data &&
            entity.data.id.uid === authorUid &&
            !entity.data.id.path?.length,
        )
        if (e) return e
        return dependentEntities.find(
          (entity) =>
            entity.data &&
            entity.data.id.uid === authorUid &&
            !entity.data.id.path?.length,
        )
      })
      .filter((author) => !!author)
      .map(
        (entity) =>
          entity.data && {
            id: entity.data.id,
            metadata: entity.data.document?.metadata,
          },
      )
      .filter((author) => !!author)
  }
  function getLocation(id: UnpackedHypermediaId): LibraryDependentData[] {
    if (id.type !== 'd') return []
    return getParentPaths(id.path)
      .slice(0, -1)
      .map((path) => {
        return hmId('d', id.uid, {path})
      })
      .map((locationId) => {
        const e = entities.find(
          (entity) => entity.data && entity.data.id.id === locationId.id,
        )
        if (e) return e
        return dependentEntities.find(
          (entity) => entity.data && entity.data.id.id === locationId.id,
        )
      })
      .filter((location) => !!location)
      .map(
        (entity) =>
          entity.data && {
            id: entity.data.id,
            metadata: entity.data.document?.metadata,
          },
      )
      .filter((location) => !!location)
  }
  const dependentEntities = useEntities(dependentEntityIds)
  if (!search.data) return null
  let results: LibraryData['items'] = [
    ...(draftQueryList
      ?.map((draftId) => {
        const id = unpackHmId(draftId)
        if (!id) return null
        const draftQueryIndex = draftQueryList.findIndex(
          (dId) => dId === draftId,
        )
        const draft = drafts[draftQueryIndex]?.data || undefined
        return {
          id,
          hasDraft: true,
          draft,
          document: undefined,
          location: getLocation(id),
          authors: getAuthors(draft ? [draft.signingAccount] : []),
          isSubscribed: false,
          isFavorite: false,
        }
      })
      .filter((result) => !!result) || []),
    ...(search.data
      ?.map((searchResult) => {
        const id = unpackHmId(searchResult.id)
        if (!id) return null

        const entity = entities.find((entity) => entity.data?.id.id === id.id)

        const hasDraft =
          draftList.data?.findIndex((draftId) => draftId === id.id) !== -1
        return {
          id,
          document: entity?.data?.document || undefined,
          draft: undefined,
          hasDraft,
          location: getLocation(id),
          authors: getAuthors(entity?.data?.document?.authors || []),
          isSubscribed:
            subscriptions.data?.findIndex((sub) => isSubscribedBy(id, sub)) !==
            -1,
          isFavorite:
            favorites?.findIndex((fav) => fav && fav.id === id.id) !== -1,
        }
      })
      .filter((result) => !!result) || []),
  ]
  if (selectedFilters.length) {
    results = results.filter((result) => {
      return selectedFilters.some((filter) => {
        switch (filter) {
          case 'drafts':
            return result.hasDraft
          case 'favorites':
            return result.isFavorite
          case 'subscribed':
            return result.isSubscribed
          default:
            return false
        }
      })
    })
  }
  if (query.filterString) {
    // even though the filter string was passed to search, drafts are not filtered out yet. we had to load them because we don't know their title after listDrafts
    results = results.filter((result) => {
      const name =
        result.document?.metadata?.name || result.draft?.metadata?.name || ''
      return name.toLowerCase().includes(query.filterString.toLowerCase())
    })
  }
  results = sortLibrary(results, query.sort)
  return {items: results, totalItemCount: search.data.length}
}

function sortLibrary(
  library: LibraryData['items'],
  sort: 'lastUpdate' | 'alphabetical',
) {
  if (sort === 'alphabetical') return alphabeticalSort(library)
  if (sort === 'lastUpdate') return lastUpdateSort(library)
  return library
}

function alphabeticalSort(library: LibraryData['items']) {
  library.sort((a, b) => {
    const aName = a.document?.metadata?.name || a.draft?.metadata?.name || ''
    const bName = b.document?.metadata?.name || b.draft?.metadata?.name || ''
    return aName.localeCompare(bName)
  })
  return library
}

function lastUpdateSort(library: LibraryData['items']) {
  library.sort((a, b) => {
    return lastUpdateOfEntry(b) - lastUpdateOfEntry(a)
  })
  return library
}

function lastUpdateOfEntry(entry: LibraryData['items'][number]) {
  return entry.document?.updateTime?.seconds
    ? Number(entry.document?.updateTime?.seconds)
    : (entry.draft?.lastUpdateTime || 0) / 1000
}
