import {
  clearNotificationEmailVerificationForAccount,
  getNotificationConfig,
  getNotificationEmailVerificationForAccount,
  isInboxRegistered,
  markNotificationConfigVerified,
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
import {resolveAccountId} from '@/verify-delegation'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {createNotificationVerificationEmail} from '@shm/emails/notifier'
import {NOTIFY_SERVICE_HOST, NOTIFY_TRUSTED_PREVALIDATORS, SITE_BASE_URL} from '@shm/shared/constants'
import {base58btc} from 'multiformats/bases/base58'
import {z} from 'zod'

const emailPrevalidationSchema = z.object({
  email: z.string(),
  sig: z.instanceof(Uint8Array),
  signer: z.instanceof(Uint8Array),
  host: z.string(),
})

const notificationConfigAction = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('get-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
  }),
  z.object({
    action: z.literal('set-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
    email: z.string(),
    emailPrevalidation: emailPrevalidationSchema.optional(),
  }),
  z.object({
    action: z.literal('resend-notification-config-verification'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
  }),
  z.object({
    action: z.literal('remove-notification-config'),
    signer: z.instanceof(Uint8Array),
    time: z.number(),
    sig: z.instanceof(Uint8Array),
    accountUid: z.string().optional(),
  }),
])

export type NotificationConfigAction = z.infer<typeof notificationConfigAction>

const notificationEmailHost = (NOTIFY_SERVICE_HOST || SITE_BASE_URL).replace(/\/$/, '')
const verbose = process.env.VERBOSE === 'true'

/** Parses the NOTIFY_TRUSTED_PREVALIDATORS env var into a set of trusted host origins. */
function getTrustedPrevalidators(): Set<string> {
  if (!NOTIFY_TRUSTED_PREVALIDATORS) return new Set()
  return new Set(
    NOTIFY_TRUSTED_PREVALIDATORS.split(',')
      .map((h) => h.trim())
      .filter(Boolean),
  )
}

if (verbose) console.log('[notify-config] trusted prevalidators:', [...getTrustedPrevalidators()])

/**
 * Fetches the signing key (signerAccountUid) from a vault host's /hm/api/config endpoint.
 * Returns the raw public key bytes, or null on failure.
 */
async function fetchHostSigningKey(host: string): Promise<Uint8Array | null> {
  try {
    const configUrl = `${host.replace(/\/$/, '')}/hm/api/config`
    if (verbose) console.log('[prevalidation] fetching host config from:', configUrl)
    const response = await fetch(configUrl, {signal: AbortSignal.timeout(10_000)})
    if (!response.ok) {
      if (verbose) console.log('[prevalidation] host config fetch failed:', response.status)
      return null
    }
    const config = (await response.json()) as {signerAccountUid?: string}
    if (!config.signerAccountUid) {
      if (verbose) console.log('[prevalidation] host config has no signerAccountUid')
      return null
    }
    if (verbose) console.log('[prevalidation] host signerAccountUid:', config.signerAccountUid)
    return new Uint8Array(base58btc.decode(config.signerAccountUid))
  } catch (e) {
    console.error('[prevalidation] failed to fetch host signing key:', e)
    return null
  }
}

/**
 * Validates an email prevalidation payload signed by a trusted vault server.
 * Fetches the host's /hm/api/config to confirm the signer matches the published signing key.
 * Returns true if the prevalidation is valid and the email can be trusted.
 */
async function validateEmailPrevalidation(
  prevalidation: z.infer<typeof emailPrevalidationSchema>,
  expectedEmail: string,
): Promise<boolean> {
  const trustedHosts = getTrustedPrevalidators()
  if (verbose) {
    console.log('[prevalidation] trusted hosts:', [...trustedHosts])
    console.log('[prevalidation] payload host:', prevalidation.host)
    console.log('[prevalidation] payload email:', prevalidation.email)
    console.log('[prevalidation] expected email:', expectedEmail)
  }

  if (!trustedHosts.has(prevalidation.host)) {
    if (verbose) console.log('[prevalidation] host not in trusted list, rejecting')
    return false
  }

  if (prevalidation.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    if (verbose) console.log('[prevalidation] email mismatch, rejecting')
    return false
  }

  // Fetch the host's published signing key and verify the prevalidation signer matches.
  const hostKey = await fetchHostSigningKey(prevalidation.host)
  if (!hostKey) {
    if (verbose) console.log('[prevalidation] could not fetch host signing key, rejecting')
    return false
  }

  const signerBytes =
    prevalidation.signer instanceof Uint8Array ? prevalidation.signer : new Uint8Array(prevalidation.signer)
  if (verbose) {
    console.log('[prevalidation] hostKey:', base58btc.encode(hostKey))
    console.log('[prevalidation] signer:', base58btc.encode(signerBytes))
  }

  if (hostKey.length !== signerBytes.length || !hostKey.every((b, i) => b === signerBytes[i])) {
    if (verbose) console.log('[prevalidation] signer does not match host signing key, rejecting')
    return false
  }
  if (verbose) console.log('[prevalidation] signer matches host signing key')

  // Reconstruct the unsigned payload and verify the signature.
  const unsignedPayload = {
    email: prevalidation.email,
    signer: prevalidation.signer,
    host: prevalidation.host,
  }
  const encodedPayload = new Uint8Array(cborEncode(unsignedPayload))

  const isValid = await validateSignature(prevalidation.signer, prevalidation.sig, encodedPayload)
  if (verbose) console.log('[prevalidation] signature valid:', isValid)

  return isValid
}

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
    isRegistered: isInboxRegistered(accountId),
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
  const now = Date.now()
  const timeDiff = Math.abs(now - restPayload.time)
  if (timeDiff > 20_000) {
    throw new BadRequestError('Request time invalid')
  }
  const accountId = await resolveAccountId(signedPayload.signer, signedPayload.accountUid)
  if (restPayload.action === 'get-notification-config') {
    return getNotificationConfigResponse(accountId)
  }
  if (restPayload.action === 'set-notification-config') {
    const normalizedEmail = normalizeEmail(restPayload.email)
    if (!normalizedEmail) {
      throw new BadRequestError('Email is required')
    }

    // Check if the request includes a valid email prevalidation from a trusted vault.
    if (restPayload.emailPrevalidation) {
      if (verbose) console.log('[set-notification-config] emailPrevalidation payload present, attempting validation...')
      const prevalidationValid = await validateEmailPrevalidation(restPayload.emailPrevalidation, normalizedEmail)
      if (prevalidationValid) {
        if (verbose) console.log('[set-notification-config] prevalidation valid, marking verified for', accountId)
        setNotificationConfig(accountId, normalizedEmail)
        markNotificationConfigVerified(accountId, normalizedEmail)
        clearNotificationEmailVerificationForAccount(accountId)
        return {
          success: true,
          ...getNotificationConfigResponse(accountId),
        }
      }
      if (verbose)
        console.log('[set-notification-config] prevalidation invalid, falling through to normal verification')
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
