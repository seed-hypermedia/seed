import {queryClient} from '@/client'
import {getMetadata} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  BIG_INT,
  Comment,
  entityQueryPathToHmIdPath,
  getCommentGroups,
  HMAccountsMetadata,
  HMChangeGroup,
  HMChangeSummary,
  HMComment,
  HMCommentGroup,
  HMDocumentInfo,
  HMDocumentMetadataSchema,
  hmId,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
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
    const res = await queryClient.comments.listComments({
      targetAccount,
      targetPath,
      pageSize: BIG_INT,
    })
    const allComments = res.comments.map(
      (rawComment: PlainMessage<Comment>) => {
        return toPlainMessage(rawComment) as HMComment
      },
    )
    const commentGroups = getCommentGroups(allComments, targetCommentId || null)
    const allAccounts = new Set<string>()
    commentGroups.forEach((commentGroup) => {
      commentGroup.comments.forEach((comment) => {
        allAccounts.add(comment.author)
      })
    })
    const siteDocs = await queryClient.documents.listDocuments({
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
          ...toPlainMessage(d),
          path: entityQueryPathToHmIdPath(d.path),
          type: 'document',
          metadata: HMDocumentMetadataSchema.parse(
            d.metadata?.toJson({emitDefaultValues: true}),
          ),
        }
      })
    const doc = await queryClient.documents.getDocument({
      account: id.uid,
      path: targetPath,
      version: id.version || undefined,
    })
    const latestDoc = await queryClient.documents.getDocument({
      account: id.uid,
      path: targetPath,
      version: undefined,
    })
    const changesQuery = await queryClient.documents.listDocumentChanges({
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
      .filter((change) => change.createTime.seconds !== 0n)
    const accounts = await Promise.all(
      Array.from(allAccounts).map(async (accountUid) => {
        return await getMetadata(hmId('d', accountUid))
      }),
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
      accountsMetadata: Object.fromEntries(
        accounts.map((account) => [
          account.id.uid,
          {id: account.id, metadata: account.metadata},
        ]),
      ) as HMAccountsMetadata,
      latestVersion: latestDoc?.version,
    }
  } catch (e: any) {
    result = {error: e.message}
  }
  return wrapJSON(result)
}
