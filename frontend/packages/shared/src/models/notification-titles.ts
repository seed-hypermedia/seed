import type {HMMetadata, UnpackedHypermediaId} from '../hm-types'

type NotificationTitleTarget = {
  targetMeta?: HMMetadata | null
  targetId?: Pick<UnpackedHypermediaId, 'path'> | null
}

export function getNotificationDocumentName(input: NotificationTitleTarget): string {
  const metadataName = input.targetMeta?.name?.trim()
  if (metadataName) return metadataName

  const pathName = input.targetId?.path?.at(-1)?.trim()
  if (pathName) return pathName

  return 'Untitled Document'
}

export function getMentionNotificationTitle(input: {
  actorName: string
  subjectName?: string | null
  documentName: string
}): string {
  const actorName = input.actorName.trim() || 'Someone'
  const subjectName = input.subjectName?.trim() || 'you'
  const documentName = input.documentName.trim() || 'Untitled Document'
  return `${actorName} mentioned ${subjectName} in ${documentName}`
}
