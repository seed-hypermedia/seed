import type * as api from '@/api'
import {encode as cborEncode} from '@ipld/dag-cbor'
import * as base64 from '@shm/shared/base64'
import type * as blobs from '@shm/shared/blobs'

type NotificationRequestSigner = Pick<blobs.NobleKeyPair, 'principal' | 'sign'>

/**
 * Notification registration and email configuration for a single account.
 */
export type NotificationConfigResponse = {
  accountId: string
  email: string | null
  verifiedTime: string | null
  verificationSendTime: string | null
  verificationExpired: boolean
  isRegistered: boolean
}

function normalizeNotificationHost(notifyServiceHost: string) {
  return notifyServiceHost.replace(/\/$/, '')
}

async function postSignedNotificationRequest<ResultType>(
  notifyServiceHost: string,
  path: string,
  signer: NotificationRequestSigner,
  payload: Record<string, unknown>,
): Promise<ResultType> {
  const unsignedPayload = {
    ...payload,
    signer: signer.principal,
    time: Date.now(),
  }
  const encodedPayload = new Uint8Array(cborEncode(unsignedPayload))
  const sig = await signer.sign(encodedPayload)
  const body = new Uint8Array(cborEncode({...unsignedPayload, sig}))
  const response = await fetch(`${normalizeNotificationHost(notifyServiceHost)}${path}`, {
    method: 'POST',
    body,
    headers: {'Content-Type': 'application/cbor'},
  })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`)
  }

  return data as ResultType
}

/**
 * Fetches notification registration and email configuration without mutating server state.
 */
export async function getNotificationConfig(
  notifyServiceHost: string,
  signer: NotificationRequestSigner,
): Promise<NotificationConfigResponse> {
  return postSignedNotificationRequest(notifyServiceHost, '/hm/api/notification-config', signer, {
    action: 'get-notification-config',
  })
}

/**
 * Registers the account on the notification server without attaching an email.
 */
export async function registerNotificationInbox(
  notifyServiceHost: string,
  signer: NotificationRequestSigner,
): Promise<boolean> {
  const data = await postSignedNotificationRequest<{registered?: boolean}>(
    notifyServiceHost,
    '/hm/api/notification-inbox',
    signer,
    {
      action: 'register-inbox',
    },
  )
  return data.registered === true
}

/**
 * Sets or replaces the notification email for a registered account.
 * When emailPrevalidation is provided, the notify server may skip email verification
 * if it trusts the vault server that signed the prevalidation.
 */
export async function setNotificationConfig(
  notifyServiceHost: string,
  signer: NotificationRequestSigner,
  email: string,
  emailPrevalidation?: api.EmailPrevalidation | null,
): Promise<NotificationConfigResponse> {
  const payload: Record<string, unknown> = {
    action: 'set-notification-config',
    email,
  }

  if (emailPrevalidation) {
    payload.emailPrevalidation = {
      email: emailPrevalidation.email,
      signer: new Uint8Array(base64.decode(emailPrevalidation.signer)),
      host: emailPrevalidation.host,
      sig: new Uint8Array(base64.decode(emailPrevalidation.sig)),
    }
  }

  return postSignedNotificationRequest(notifyServiceHost, '/hm/api/notification-config', signer, payload)
}

/**
 * Removes the notification email while keeping the account registration.
 */
export async function removeNotificationConfig(
  notifyServiceHost: string,
  signer: NotificationRequestSigner,
): Promise<NotificationConfigResponse> {
  return postSignedNotificationRequest(notifyServiceHost, '/hm/api/notification-config', signer, {
    action: 'remove-notification-config',
  })
}
