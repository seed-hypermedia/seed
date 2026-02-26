import type {Notification} from '@shm/emails/notifier'

export type NotifReason = Notification['reason']
export type NotificationDeliveryKind = 'immediate' | 'batch'

type DiscussionCapableSubscription = {
  notifyAllDiscussions: boolean
  notifySiteDiscussions: boolean
}

const deliveryKindByReason: Record<NotifReason, NotificationDeliveryKind | null> = {
  mention: 'immediate',
  reply: 'immediate',
  discussion: 'immediate',
  'site-doc-update': 'batch',
  'site-new-discussion': 'batch',
  'user-comment': null,
}

export function getNotificationDeliveryKind(reason: NotifReason): NotificationDeliveryKind | null {
  return deliveryKindByReason[reason]
}

export function getDiscussionNotificationReason(
  subscription: DiscussionCapableSubscription,
): 'discussion' | 'site-new-discussion' | null {
  if (subscription.notifyAllDiscussions) return 'discussion'
  if (subscription.notifySiteDiscussions) return 'site-new-discussion'
  return null
}
