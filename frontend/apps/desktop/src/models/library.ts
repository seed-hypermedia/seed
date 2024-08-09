import {
  HMDocument,
  HMDraft,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {useDrafts} from './accounts'
import {useDraftList} from './documents'
import {getParentPaths, useEntities} from './entities'
import {useSearch} from './search'

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
export type LibraryData = Array<{
  id: UnpackedHypermediaId
  document?: HMDocument
  hasDraft: boolean
  draft?: HMDraft
  location: LibraryDependentData[]
  authors: LibraryDependentData[]
}>

export function useLibrary(query: LibraryQueryState): LibraryData {
  const search = useSearch(query.filterString, {})
  const draftList = useDraftList()
  const searchedIds =
    search.data?.map((entity) => unpackHmId(entity.id)).filter((id) => !!id) ||
    []
  const draftQueryList = draftList.data?.filter(
    (draftId) =>
      search.data?.findIndex((searchResult) => searchResult.id === draftId) ===
      -1,
  )
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
  const results: LibraryData = [
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
        }
      })
      .filter((result) => !!result) || []),
  ]
  if (query.sort === 'alphabetical') return alphabeticalSort(results)
  if (query.sort === 'lastUpdate') return lastUpdateSort(results)
  return results
}

function alphabeticalSort(library: LibraryData) {
  library.sort((a, b) => {
    const aName = a.document?.metadata?.name || a.draft?.metadata?.name || ''
    const bName = b.document?.metadata?.name || b.draft?.metadata?.name || ''
    return aName.localeCompare(bName)
  })
  return library
}

function lastUpdateSort(library: LibraryData) {
  library.sort((a, b) => {
    return lastUpdateOfEntry(b) - lastUpdateOfEntry(a)
  })
  return library
}

function lastUpdateOfEntry(entry: LibraryData[number]) {
  return entry.document?.updateTime?.seconds
    ? Number(entry.document?.updateTime?.seconds)
    : (entry.draft?.lastUpdateTime || 0) / 1000
}
