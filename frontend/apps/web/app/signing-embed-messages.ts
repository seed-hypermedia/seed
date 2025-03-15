import {z} from 'zod'
import {unsignedCommentSchema} from './api'
import {AbilitySchema} from './local-db'

// delegate messages

export const initMessageSchema = z.object({
  type: z.literal('init'),
})
export type InitMessage = z.infer<typeof initMessageSchema>

export const requestSignCommentMessageSchema = z.object({
  type: z.literal('requestSignComment'),
  signatureId: z.string(),
  comment: unsignedCommentSchema,
})
export type RequestSignCommentMessage = z.infer<
  typeof requestSignCommentMessageSchema
>

export const embedSigningDelegateMessageSchema = z.discriminatedUnion('type', [
  initMessageSchema,
  requestSignCommentMessageSchema,
])
export type EmbedSigningDelegateMessage = z.infer<
  typeof embedSigningDelegateMessageSchema
>

// identity provider messages

export const readyMessageSchema = z.object({
  type: z.literal('ready'),
})
export type ReadyMessage = z.infer<typeof readyMessageSchema>

export const abilitiesMessageSchema = z.object({
  type: z.literal('abilities'),
  abilities: z.array(AbilitySchema),
})
export type AbilitiesMessage = z.infer<typeof abilitiesMessageSchema>

export const resolveSignatureMessageSchema = z.object({
  type: z.literal('resolveSignature'),
  signatureId: z.string(),
  signature: z.instanceof(ArrayBuffer),
})
export type ResolveSignatureMessage = z.infer<
  typeof resolveSignatureMessageSchema
>

export const rejectSignatureMessageSchema = z.object({
  type: z.literal('rejectSignature'),
  signatureId: z.string(),
  error: z.string(),
})
export type RejectSignatureMessage = z.infer<
  typeof rejectSignatureMessageSchema
>

export const embedSigningIdentityProviderMessage = z.discriminatedUnion(
  'type',
  [
    readyMessageSchema,
    abilitiesMessageSchema,
    resolveSignatureMessageSchema,
    rejectSignatureMessageSchema,
  ],
)
export type EmbedSigningIdentityProviderMessage = z.infer<
  typeof embedSigningIdentityProviderMessage
>
