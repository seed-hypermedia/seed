/**
 * Resolves the exact UI state for an opened comment discussion.
 */
export function getFocusedCommentViewState({
  hasFocusedComment,
  resourceType,
  isResourceTombstone,
  isResourceLoading,
  showDeletedContent,
  hasDeletedVersion,
  isDeletedVersionsLoading,
}: {
  hasFocusedComment: boolean
  resourceType?: 'comment' | 'document' | 'tombstone' | 'not-found' | 'error' | 'redirect' | null
  isResourceTombstone: boolean
  isResourceLoading: boolean
  showDeletedContent: boolean
  hasDeletedVersion: boolean
  isDeletedVersionsLoading: boolean
}) {
  if (hasFocusedComment) return 'comment'

  const isDeleted = isResourceTombstone || resourceType === 'tombstone'
  if (showDeletedContent && isDeleted && hasDeletedVersion) return 'deleted-preview'
  if (showDeletedContent && isDeleted && isDeletedVersionsLoading) return 'deleted-loading'
  if (isResourceLoading) return 'loading'
  if (isDeleted) return 'deleted'
  if (resourceType === 'not-found') return 'not-found'

  return 'not-found'
}
