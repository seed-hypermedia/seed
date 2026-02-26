import {describe, expect, it} from 'vitest'
import {getDiscussionNotificationReason, getNotificationDeliveryKind} from './notification-routing'

describe('notification routing', () => {
  it('routes desktop-equivalent notification reasons as immediate', () => {
    expect(getNotificationDeliveryKind('mention')).toBe('immediate')
    expect(getNotificationDeliveryKind('reply')).toBe('immediate')
    expect(getNotificationDeliveryKind('discussion')).toBe('immediate')
  })

  it('routes legacy digest reasons as batch', () => {
    expect(getNotificationDeliveryKind('site-doc-update')).toBe('batch')
    expect(getNotificationDeliveryKind('site-new-discussion')).toBe('batch')
  })

  it('does not route unsupported reasons', () => {
    expect(getNotificationDeliveryKind('user-comment')).toBeNull()
  })

  it('prefers desktop discussion reason when both modes are enabled', () => {
    expect(
      getDiscussionNotificationReason({
        notifyAllDiscussions: true,
        notifySiteDiscussions: true,
      }),
    ).toBe('discussion')
  })

  it('uses site discussion reason for batch subscriptions', () => {
    expect(
      getDiscussionNotificationReason({
        notifyAllDiscussions: false,
        notifySiteDiscussions: true,
      }),
    ).toBe('site-new-discussion')
  })
})
