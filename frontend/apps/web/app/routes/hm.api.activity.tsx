import {grpcClient} from '@/client.server'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {
  entityQueryPathToHmIdPath,
  getCommentGroups,
  HMAccountsMetadata,
  HMChangeGroup,
  HMChangeSummary,
  HMComment,
  HMCommentGroup,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {getActivityTime} from '@shm/shared/models/activity'

export type ActivityPayload = {
  activity?: (HMCommentGroup | HMChangeGroup | HMDocumentInfo)[]
  accountsMetadata?: HMAccountsMetadata
  latestVersion?: string
  error?: string
}

export const loader = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<ActivityPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)
  const targetCommentId = url.searchParams.get('targetCommentId')
  if (!id) throw new Error('id is required')
  let result: ActivityPayload
  try {
    const targetAccount = id.uid
    const targetPath = hmIdPathToEntityQueryPath(id.path)
    const res = await grpcClient.comments.listComments({
      targetAccount,
      targetPath,
      pageSize: BIG_INT,
    })
    const allComments = res.comments.map(
      (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
    )
    // @ts-expect-error
    const commentGroups = getCommentGroups(allComments, targetCommentId || null)
    const allAccounts = new Set<string>()
    commentGroups.forEach((commentGroup) => {
      commentGroup.comments.forEach((comment) => {
        allAccounts.add(comment.author)
      })
    })
    const siteDocs = await grpcClient.documents.listDocuments({
      account: id.uid,
      pageSize: BIG_INT,
    })
    const pathPrefix = id.path?.join('/') || ''
    const subDocs: HMDocumentInfo[] = siteDocs.documents
      .filter((item) => {
        const path = entityQueryPathToHmIdPath(item.path)
        if (!path?.length) return false
        if (path.length !== (id.path?.length || 0) + 1) return false
        const pathStr = path.join('/')
        if (!pathStr.startsWith(pathPrefix)) return false
        return true
      })
      .map((d) => {
        return {
          // @ts-expect-error
          ...d.toJson({emitDefaultValues: true}),
          path: entityQueryPathToHmIdPath(d.path),
          type: 'document',
          metadata: HMDocumentMetadataSchema.parse(
            d.metadata?.toJson({emitDefaultValues: true}),
          ),
        }
      })
    const doc = await grpcClient.documents.getDocument({
      account: id.uid,
      path: targetPath,
      version: id.version || undefined,
    })
    const latestDoc = await grpcClient.documents.getDocument({
      account: id.uid,
      path: targetPath,
      version: undefined,
    })
    const changesQuery = await grpcClient.documents.listDocumentChanges({
      account: id.uid,
      path: targetPath,
      version: doc.version,
      pageSize: BIG_INT,
    })
    changesQuery.changes.forEach((change) => {
      allAccounts.add(change.author)
    })
    const changes = changesQuery.changes
      .map((change) => {
        return {
          ...change,
          type: 'change',
        } as HMChangeSummary
      })
      .filter((change) => change.createTime?.seconds !== 0n)
    const accounts: HMAccountsMetadata = Object.fromEntries(
      await Promise.all(
        Array.from(allAccounts).map(async (accountUid) => {
          return [accountUid, await getAccount(accountUid)]
        }),
      ),
    )
    const activity: (HMCommentGroup | HMChangeSummary | HMDocumentInfo)[] = [
      ...commentGroups,
      ...changes,
      ...subDocs,
    ]
    activity.sort((a, b) => {
      const aTime = getActivityTime(a)
      const bTime = getActivityTime(b)
      if (!aTime) return 1
      if (!bTime) return -1
      return aTime.getTime() - bTime.getTime()
    })
    const activityWithGroups: (
      | HMCommentGroup
      | HMChangeGroup
      | HMDocumentInfo
    )[] = []
    let currentChangeGroup: HMChangeGroup | null = null
    activity?.forEach((item) => {
      if (item.type !== 'change') {
        if (currentChangeGroup) {
          activityWithGroups.push(currentChangeGroup)
          currentChangeGroup = null
        }
        activityWithGroups.push(item)
      } else if (
        currentChangeGroup &&
        item.author === currentChangeGroup.changes[0]?.author
      ) {
        currentChangeGroup.changes.push(item)
      } else if (currentChangeGroup) {
        activityWithGroups.push(currentChangeGroup)
        currentChangeGroup = {
          id: item.id,
          type: 'changeGroup',
          changes: [item],
        }
      } else {
        currentChangeGroup = {
          id: item.id,
          type: 'changeGroup',
          changes: [item],
        }
      }
    })
    if (currentChangeGroup) {
      activityWithGroups.push(currentChangeGroup)
    }
    result = {
      activity: activityWithGroups,
      accountsMetadata: accounts,
      latestVersion: latestDoc?.version,
    }
  } catch (e: any) {
    result = {error: e.message}
  }
  return wrapJSON(result)
}
