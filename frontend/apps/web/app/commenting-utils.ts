import {WEB_IDENTITY_ORIGIN} from '@shm/shared'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'

export function redirectToWebIdentityCommenting(
  targetDocId: UnpackedHypermediaId,
  replyCommentId: string | null,
  rootReplyCommentId: string | null,
) {
  const url = new URL(`${WEB_IDENTITY_ORIGIN}/hm/comment`)
  url.searchParams.set(
    'target',
    `${targetDocId.uid}${hmIdPathToEntityQueryPath(targetDocId.path)}`,
  )
  url.searchParams.set('targetVersion', targetDocId.version || '')
  url.searchParams.set('reply', replyCommentId || '')
  url.searchParams.set('rootReply', rootReplyCommentId || '')
  url.searchParams.set('originUrl', window.location.toString())
  window.open(url.toString(), '_blank')
}
