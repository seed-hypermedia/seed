import {
  clearNotificationEmailVerificationForAccount,
  getEmail,
  getNotificationConfig,
  getNotificationEmailVerificationByToken,
  markNotificationConfigVerified,
} from './db'
import {buildNotificationEmailVerificationUrl as buildVerifyUrl, getNotifyEmailOrigin} from '@shm/emails/notify-links'

export const EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS = 2 * 60 * 60 * 1000

/** Email link that verifies the notification email (`/hm/api/notify/verify-email`). */
export function buildNotificationEmailVerificationUrl(input: {notifyServiceHost?: string; token: string}) {
  return buildVerifyUrl(getNotifyEmailOrigin(input.notifyServiceHost), input.token)
}

export function isNotificationEmailVerificationExpired(sendTime: string, nowMs: number = Date.now()) {
  const sendMs = new Date(sendTime).getTime()
  if (!Number.isFinite(sendMs) || sendMs <= 0) return true
  return nowMs - sendMs > EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS
}

export function applyNotificationEmailVerificationFromEmailLink(input: {token: string; nowMs?: number}) {
  const verification = getNotificationEmailVerificationByToken(input.token)
  if (!verification) {
    return {applied: false, reason: 'invalid-token' as const}
  }

  const nowMs = input.nowMs ?? Date.now()
  const config = getNotificationConfig(verification.accountId)
  const emailRecord = getEmail(verification.email)
  const adminToken = emailRecord?.adminToken

  if (!config) {
    return {
      applied: false,
      reason: 'notification-config-missing' as const,
      accountId: verification.accountId,
      email: verification.email,
      adminToken,
    }
  }

  if (config.email !== verification.email) {
    return {
      applied: false,
      reason: 'notification-config-email-mismatch' as const,
      accountId: verification.accountId,
      email: verification.email,
      adminToken,
    }
  }

  if (config.verifiedTime) {
    clearNotificationEmailVerificationForAccount(verification.accountId)
    return {
      applied: false,
      reason: 'already-verified' as const,
      accountId: verification.accountId,
      email: verification.email,
      adminToken,
    }
  }

  if (isNotificationEmailVerificationExpired(verification.sendTime, nowMs)) {
    return {
      applied: false,
      reason: 'verification-expired' as const,
      accountId: verification.accountId,
      email: verification.email,
      adminToken,
      sendTime: verification.sendTime,
    }
  }

  const marked = markNotificationConfigVerified(verification.accountId, verification.email)
  if (!marked) {
    return {
      applied: false,
      reason: 'verify-write-failed' as const,
      accountId: verification.accountId,
      email: verification.email,
      adminToken,
    }
  }

  clearNotificationEmailVerificationForAccount(verification.accountId)

  const updated = getNotificationConfig(verification.accountId)
  return {
    applied: true,
    reason: 'ok' as const,
    accountId: verification.accountId,
    email: verification.email,
    adminToken,
    verifiedTime: updated?.verifiedTime ?? new Date(nowMs).toISOString(),
  }
}
