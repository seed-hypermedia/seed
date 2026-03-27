import {
  clearNotificationEmailVerificationForAccount,
  getNotificationConfig,
  getNotificationEmailVerificationForAccount,
  getNotificationReadState,
  getNotificationsPage,
  removeNotificationConfig,
  replaceNotificationReadState,
  setNotificationConfig,
  setNotificationEmailVerification,
} from './db'
import {sendEmail} from './mailer'
import {
  buildNotificationEmailVerificationUrl,
  isNotificationEmailVerificationExpired,
} from './notification-email-verification'
import {createNotificationVerificationEmail} from '@shm/emails/notifier'
import {NOTIFY_SERVICE_HOST, SITE_BASE_URL} from '@shm/shared/constants'
import {
  reduceNotificationStateActions,
  type NotificationConfigState,
  type NotificationMutationAction,
  type NotificationStateSnapshot,
} from '@shm/shared/models/notification-state'

const notificationEmailHost = (NOTIFY_SERVICE_HOST || SITE_BASE_URL).replace(/\/$/, '')

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getNotificationConfigState(accountId: string): NotificationConfigState {
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
    throw new Error('Notify service host is not configured')
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

async function persistNotificationConfigState(
  accountId: string,
  currentConfig: NotificationConfigState,
  nextConfig: NotificationConfigState,
) {
  if (!nextConfig.email) {
    removeNotificationConfig(accountId)
    clearNotificationEmailVerificationForAccount(accountId)
    return
  }

  const normalizedEmail = normalizeEmail(nextConfig.email)
  setNotificationConfig(accountId, normalizedEmail)

  if (nextConfig.verifiedTime) {
    clearNotificationEmailVerificationForAccount(accountId)
    return
  }

  if (!nextConfig.verificationSendTime) {
    clearNotificationEmailVerificationForAccount(accountId)
    return
  }

  const currentVerification = getNotificationEmailVerificationForAccount(accountId)
  const shouldSendVerification =
    currentConfig.email !== normalizedEmail ||
    currentConfig.verificationSendTime !== nextConfig.verificationSendTime ||
    currentVerification?.email !== normalizedEmail ||
    currentVerification?.sendTime !== nextConfig.verificationSendTime

  setNotificationEmailVerification({
    accountId,
    email: normalizedEmail,
    sendTime: nextConfig.verificationSendTime,
  })

  if (shouldSendVerification) {
    const verification = getNotificationEmailVerificationForAccount(accountId)
    if (!verification) {
      throw new Error('Failed to save notification email verification')
    }
    await sendNotificationVerificationEmail(normalizedEmail, verification.token)
  }
}

/** Returns the canonical notification state snapshot for an account. */
export function getNotificationStateSnapshot(
  accountId: string,
  opts: {beforeMs?: number; limit?: number} = {},
): NotificationStateSnapshot {
  const inbox = getNotificationsPage(accountId, opts)
  return {
    accountId,
    inbox,
    config: getNotificationConfigState(accountId),
    readState: getNotificationReadState(accountId),
  }
}

/** Applies shared notification actions on the notify service and returns canonical state. */
export async function applyNotificationActionsForAccount(
  accountId: string,
  actions: NotificationMutationAction[],
  opts: {beforeMs?: number; limit?: number} = {},
): Promise<NotificationStateSnapshot> {
  if (!actions.length) {
    return getNotificationStateSnapshot(accountId, opts)
  }

  const currentState = getNotificationStateSnapshot(accountId, opts)
  const nextState = reduceNotificationStateActions(currentState, actions)

  replaceNotificationReadState(accountId, {
    markAllReadAtMs: nextState.readState.markAllReadAtMs,
    readEvents: nextState.readState.readEvents,
  })
  await persistNotificationConfigState(accountId, currentState.config, nextState.config)

  return getNotificationStateSnapshot(accountId, opts)
}
