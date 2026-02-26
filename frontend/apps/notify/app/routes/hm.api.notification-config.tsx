import {
  clearNotificationEmailVerificationForAccount,
  getNotificationConfig,
  getNotificationEmailVerificationForAccount,
  removeNotificationConfig,
  setNotificationConfig,
  setNotificationEmailVerification,
} from '@/db'
import {sendEmail} from '@/mailer'
import {
  buildNotificationEmailVerificationUrl,
  isNotificationEmailVerificationExpired,
} from '@/notification-email-verification'
import {BadRequestError, cborApiAction} from '@/server-api'
import {validateSignature} from '@/validate-signature'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {createNotificationVerificationEmail} from '@shm/emails/notifier'
import {NOTIFY_SERVICE_HOST, SITE_BASE_URL} from '@shm/shared/constants'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const notificationConfigAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
  z.object({
    action: z.literal('set-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    email: z.string(),
  }),
  z.object({
    action: z.literal('resend-notification-config-verification'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
  z.object({
    action: z.literal('remove-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
  }),
])

export type NotificationConfigAction = z.infer<typeof notificationConfigAction>

const notificationEmailHost = (NOTIFY_SERVICE_HOST || SITE_BASE_URL).replace(/\/$/, '')

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getNotificationConfigResponse(accountId: string) {
  const config = getNotificationConfig(accountId)
  const verification = config ? getNotificationEmailVerificationForAccount(accountId) : null
  const activeVerification =
    !config?.verifiedTime && verification && config && verification.email === config.email ? verification : null
  const verificationSendTime = activeVerification?.sendTime ?? null
  const verificationExpired = verificationSendTime
    ? isNotificationEmailVerificationExpired(verificationSendTime)
    : false
  return {
    accountId,
    email: config?.email ?? null,
    verifiedTime: config?.verifiedTime ?? null,
    verificationSendTime,
    verificationExpired,
  }
}

async function sendNotificationVerificationEmail(email: string, token: string) {
  if (!notificationEmailHost) {
    throw new BadRequestError('Notify service host is not configured')
  }
  const verificationUrl = buildNotificationEmailVerificationUrl({
    notifyServiceHost: notificationEmailHost,
    token,
  })
  const verificationEmail = createNotificationVerificationEmail({
    verificationUrl,
  })
  await sendEmail(email, verificationEmail.subject, {
    text: verificationEmail.text,
    html: verificationEmail.html,
  })
}

export const action = cborApiAction<NotificationConfigAction, any>(async (signedPayload) => {
  const {sig, ...restPayload} = signedPayload
  const isValid = await validateSignature(signedPayload.signer, signedPayload.sig, cborEncode(restPayload))
  if (!isValid) {
    throw new BadRequestError('Invalid signature')
  }
  const accountId = base58btc.encode(signedPayload.signer)
  const now = Date.now()
  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    throw new BadRequestError('Request time invalid')
  }
  if (restPayload.action === 'get-notification-config') {
    return getNotificationConfigResponse(accountId)
  }
  if (restPayload.action === 'set-notification-config') {
    const normalizedEmail = normalizeEmail(restPayload.email)
    if (!normalizedEmail) {
      throw new BadRequestError('Email is required')
    }

    const previousConfig = getNotificationConfig(accountId)
    setNotificationConfig(accountId, normalizedEmail)
    const nextConfig = getNotificationConfig(accountId)
    if (!nextConfig) {
      throw new BadRequestError('Failed to set notification config')
    }

    if (nextConfig.verifiedTime) {
      clearNotificationEmailVerificationForAccount(accountId)
      return {
        success: true,
        ...getNotificationConfigResponse(accountId),
      }
    }

    const existingVerification = getNotificationEmailVerificationForAccount(accountId)
    const emailChanged = previousConfig?.email !== normalizedEmail
    const hasActiveVerification = Boolean(
      existingVerification &&
        existingVerification.email === normalizedEmail &&
        !isNotificationEmailVerificationExpired(existingVerification.sendTime),
    )

    if (emailChanged || !hasActiveVerification) {
      const verification = setNotificationEmailVerification({
        accountId,
        email: normalizedEmail,
      })
      await sendNotificationVerificationEmail(normalizedEmail, verification.token)
    }

    return {
      success: true,
      ...getNotificationConfigResponse(accountId),
    }
  }
  if (restPayload.action === 'resend-notification-config-verification') {
    const config = getNotificationConfig(accountId)
    if (!config?.email) {
      throw new BadRequestError('Notification email is not configured')
    }
    if (config.verifiedTime) {
      throw new BadRequestError('Email is already verified')
    }
    const existingVerification = getNotificationEmailVerificationForAccount(accountId)
    const hasActiveVerification = Boolean(
      existingVerification &&
        existingVerification.email === config.email &&
        !isNotificationEmailVerificationExpired(existingVerification.sendTime),
    )
    if (hasActiveVerification) {
      throw new BadRequestError('Verification email already sent recently')
    }

    const verification = setNotificationEmailVerification({
      accountId,
      email: config.email,
    })
    await sendNotificationVerificationEmail(config.email, verification.token)
    return {
      success: true,
      ...getNotificationConfigResponse(accountId),
    }
  }
  if (restPayload.action === 'remove-notification-config') {
    const removed = removeNotificationConfig(accountId)
    return {
      success: removed,
      ...getNotificationConfigResponse(accountId),
    }
  }
  throw new BadRequestError('Invalid action')
})
