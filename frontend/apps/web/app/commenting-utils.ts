import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'

export function redirectToWebIdentityCommenting(
  targetDocId: UnpackedHypermediaId,
  {
    replyCommentId,
    quotingBlockId,
    replyCommentVersion,
    rootReplyCommentVersion,
  }: {
    replyCommentId?: string | null
    replyCommentVersion?: string | null
    rootReplyCommentVersion?: string | null
    quotingBlockId?: string | null
  } = {},
) {
  const url = new URL(`${WEB_IDENTITY_ORIGIN}/hm/comment`)
  url.searchParams.set(
    'target',
    `${targetDocId.uid}${hmIdPathToEntityQueryPath(targetDocId.path)}`,
  )
  url.searchParams.set('targetVersion', targetDocId.version || '')
  url.searchParams.set('replyId', replyCommentId || '')
  url.searchParams.set('replyVersion', replyCommentVersion || '')
  url.searchParams.set(
    'rootReplyVersion',
    rootReplyCommentVersion || replyCommentVersion || '',
  )
  url.searchParams.set('quoteBlock', quotingBlockId || '')
  url.searchParams.set('originUrl', window.location.toString())
  window.open(url.toString(), '_blank')
}
