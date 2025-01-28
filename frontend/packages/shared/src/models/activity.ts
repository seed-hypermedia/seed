import {HMChangeGroup, HMChangeSummary, HMDocumentInfo} from '..'
import {HMCommentGroup} from '../hm-types'
import {normalizeDate} from '../utils'

export function getActivityTime(
  activity: HMCommentGroup | HMChangeSummary | HMDocumentInfo | HMChangeGroup,
) {
  if (activity.type === 'change') return normalizeDate(activity.createTime)
  if (activity.type === 'commentGroup')
    return normalizeDate(activity.comments[0].createTime)
  if (activity.type === 'document') {
    const updateTime = normalizeDate(activity.updateTime)
    const commentTime = normalizeDate(
      activity.activitySummary?.latestCommentTime,
    )
    // return the largest value
    if (commentTime && updateTime && commentTime > updateTime)
      return commentTime
    return updateTime
  }
  if (activity.type === 'changeGroup') {
    return normalizeDate(activity.changes.at(-1)?.createTime)
  }
  return undefined
}
