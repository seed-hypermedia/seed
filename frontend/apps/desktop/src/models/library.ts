import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMAccount,
  HMComment,
  HMDocument,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  HMLibraryDocument,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {documentMetadataParseAdjustments} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {useQuery} from '@tanstack/react-query'
import {useAccountList} from './accounts'
import {useComments} from './comments'
import {useFavorites} from './favorites'
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

export type LibrarySite = HMAccount & {
  type: 'site'
  latestComment?: HMComment | null
}

export type LibraryItem = LibrarySite | HMLibraryDocument

export function useLibrary({
  grouping,
  displayMode,
}: {
  grouping: 'site' | 'none'
  displayMode: 'all' | 'subscribed' | 'favorites'
}) {
  const accounts = useAccountList()
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
      const plainAccount = toPlainMessage(account)
      return {
        ...plainAccount,

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
  const allDocuments = useQuery({
    queryKey: [queryKeys.LIBRARY],
    enabled,
    queryFn: async () => {
      const res = await grpcClient.documents.listDocuments({
        pageSize: BIG_INT,
      })
      return res.documents.map((docInfo) => {
        return {
          ...toPlainMessage(docInfo),
          metadata: HMDocumentMetadataSchema.parse(docInfo.metadata),
          type: 'document',
          path: entityQueryPathToHmIdPath(docInfo.path),
        } as HMDocumentInfo
      })
    },
  })
  return allDocuments
}

export function useSiteLibrary(siteUid: string, enabled: boolean) {
  const siteDocuments = useQuery({
    queryKey: [queryKeys.SITE_LIBRARY, siteUid],
    enabled,
    queryFn: async () => {
      const res = await grpcClient.documents.listDocuments({
        account: siteUid,
        pageSize: BIG_INT,
      })
      res.documents?.forEach((d) => {
        documentMetadataParseAdjustments(d.metadata)
      })
      return {
        documents: res.documents.map((d) => {
          const metadataJSON = d.metadata?.toJson({emitDefaultValues: true})
          documentMetadataParseAdjustments(metadataJSON)
          return {
            ...toPlainMessage(d),
            metadata: HMDocumentMetadataSchema.parse(metadataJSON),
          }
        }),
      }
    },
  })
  const commentIds = siteDocuments.data?.documents
    .map((doc) => doc.activitySummary?.latestCommentId)
    .filter((commentId) => commentId != null)
    .filter((commentId) => commentId.length)
  const comments = useComments(commentIds || [])

  const data: HMLibraryDocument[] = siteDocuments.data?.documents.map(
    (doc) => ({
      ...doc,
      path: entityQueryPathToHmIdPath(doc.path),
      type: 'document',
      latestComment: comments.find(
        (c) => c.data?.id === doc.activitySummary?.latestCommentId,
      )?.data,
    }),
  )

  return {
    ...siteDocuments,
    data,
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
