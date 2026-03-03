import z from 'zod'

export const NotificationAuthorSchema = z.object({
  uid: z.string(),
  name: z.string().nullable(),
  icon: z.string().nullable(),
})
export type NotificationAuthor = z.infer<typeof NotificationAuthorSchema>

export const NotificationTargetSchema = z.object({
  uid: z.string(),
  path: z.array(z.string()).nullable(),
  name: z.string().nullable(),
})
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>

export const NotificationReasonSchema = z.enum([
  'mention',
  'reply',
  'discussion',
  'site-doc-update',
  'site-new-discussion',
  'user-comment',
])
export type NotificationReason = z.infer<typeof NotificationReasonSchema>

export const NotificationPayloadSchema = z.object({
  feedEventId: z.string(),
  eventAtMs: z.number(),
  reason: NotificationReasonSchema,
  eventType: z.string(),
  author: NotificationAuthorSchema,
  target: NotificationTargetSchema,
  commentId: z.string().nullable(),
  sourceId: z.string().nullable(),
  citationType: z.enum(['d', 'c']).nullable(),
})
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>

export const NotificationInboxResponseSchema = z.object({
  accountId: z.string(),
  notifications: z.array(NotificationPayloadSchema),
  hasMore: z.boolean(),
  oldestEventAtMs: z.number().nullable(),
})
export type NotificationInboxResponse = z.infer<typeof NotificationInboxResponseSchema>
