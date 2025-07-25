import {grpcClient} from '@/grpc-client'
import {
  AuthorVersion,
  Change,
} from '@shm/shared/client/.generated/entities/v1alpha/entities_pb'
import {DAEMON_HTTP_PORT} from '@shm/shared/constants'
import {queryKeys} from '@shm/shared/models/query-keys'
import {UseQueryOptions, useQueries, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

export function useDocHistory(docId?: string, variantVersion?: string) {
  const {data} = useDocumentTimeline(docId)
  const changes = useMemo(() => {
    const allVariantChanges = new Set<string>()
    const variantVersionChanges: TimelineChange[] = []
    variantVersion
      ?.split('.')
      .map((chId) => data?.allChanges[chId])
      .forEach((ch) => {
        if (!ch) return
        variantVersionChanges.push(ch)
        allVariantChanges.add(ch.id)
      })
    let walkLeafVersions = variantVersionChanges
    while (walkLeafVersions?.length) {
      const nextLeafVersions: TimelineChange[] = []
      for (const change of walkLeafVersions) {
        change?.change.deps?.map((depChangeId: string) => {
          allVariantChanges.add(depChangeId)
          const depChange = data?.allChanges[depChangeId]
          if (depChange) {
            nextLeafVersions.push(depChange)
          }
        })
      }
      walkLeafVersions = nextLeafVersions
    }
    return Array.from(allVariantChanges)
      .map((changeId) => data?.allChanges[changeId])
      .filter((c) => !!c)
      .sort((a, b) => {
        let dateA = a?.change.createTime ? a.change.createTime.toDate() : 0
        let dateB = b?.change.createTime ? b.change.createTime.toDate() : 1
        // @ts-ignore
        return dateB - dateA
      })
  }, [data, variantVersion])
  return changes
}

export type TimelineChange = {
  change: Change
  deps: string[]
  citations: string[]
  id: string
}

export type HMTimeline = {
  changes: Record<string, Change>
  allChanges: Record<string, TimelineChange>
  authorVersions: AuthorVersion[]
  timelineEntries: [string, Change][]
  changesByTime: string[]
  heads: string[]
  owner: string
  roots: string[]
}

export function useDocumentTimeline(
  entityId?: string,
  includeDrafts: boolean = false,
  opts?: UseQueryOptions<unknown, unknown, HMTimeline>,
) {
  return useQuery({
    queryFn: async () => {
      const rawTimeline = await grpcClient.entities.getEntityTimeline({
        id: entityId || '',
        includeDrafts,
      })
      const timelineEntries = Object.entries(rawTimeline.changes)
      const allChanges: Record<string, TimelineChange> = {}
      timelineEntries.forEach(([changeId, change]) => {
        allChanges[changeId] = {
          deps: change.deps,
          citations: [],
          change: change,
          id: change.id,
        }
      })
      timelineEntries.forEach(([changeId, change]) => {
        change.deps.forEach((depId) => {
          allChanges[depId]?.citations.push(changeId)
        })
      })
      const timeline: HMTimeline = {
        changes: rawTimeline.changes,
        allChanges,
        authorVersions: rawTimeline.authorVersions,
        timelineEntries,
        changesByTime: rawTimeline.changesByTime,
        heads: rawTimeline.heads,
        owner: rawTimeline.owner,
        roots: rawTimeline.roots,
      }
      return timeline
    },
    queryKey: [queryKeys.ENTITY_TIMELINE, entityId, includeDrafts],
    enabled: !!entityId,
    ...opts,
  })
}

export function useChange(changeId?: string) {
  return useQuery({
    queryFn: () =>
      grpcClient.entities.getChange({
        id: changeId || '',
      }),
    queryKey: [queryKeys.CHANGE, changeId],
    enabled: !!changeId,
  })
}
export type IPLDRef = {
  '/': string
}
export type IPLDBytes = {
  '/': {
    bytes: string
  }
}
export type IPLDNode = IPLDRef | IPLDBytes

export type ChangeBlob<EntitySchema> = {
  '@type': 'Change'
  // action: 'Update', // seems to appear on group changes but not account changes
  delegation: IPLDRef
  deps: IPLDRef[]
  entity: string // entity id like hm://123
  hlcTime: number
  patch: Partial<EntitySchema>
  sig: IPLDBytes
  signer: IPLDRef
}

export type ProfileSchema = {
  alias: string
  bio: string
  avatar: IPLDRef
}

// todo, add KeyDelegationData CommentData and any other JSON blobs
export type ChangeData = ChangeBlob<ProfileSchema> // todo: add DocumentSchema
export type BlobData = ChangeData

function queryBlob(cid: string | undefined) {
  return {
    queryFn: async () => {
      const res = await fetch(
        `http://localhost:${DAEMON_HTTP_PORT}/debug/cid/${cid}`,
      )
      const data = await res.json()
      return data as BlobData
    },
    queryKey: [queryKeys.BLOB_DATA, cid],
    enabled: !!cid,
  }
}

export function useBlobsData(cids?: string[]) {
  return useQueries({
    queries: cids?.map((cid) => queryBlob(cid)) || [],
  })
}

export function useBlobData(cid?: string) {
  return useQuery(queryBlob(cid))
}
