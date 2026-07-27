/**
 * A "pending space" is a local-only home draft that a
 * signed-out user is editing before they have an account.
 * It is addressed by a uid with this prefix, which is not
 * a real account so backend entity queries (capabilities,
 * collaborators, directory, …) must be skipped for it.
 */

export const PENDING_SPACE_UID_PREFIX = 'pending-'

export function isPendingSpaceUid(uid: string | null | undefined): boolean {
  return !!uid && uid.startsWith(PENDING_SPACE_UID_PREFIX)
}
