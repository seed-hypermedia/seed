import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import type {NotificationMutationAction, NotificationStateSnapshot} from './notification-state'

const DEFAULT_NOTIFICATION_INBOX_LIMIT = 400

/** Signs notify-service requests for an account or delegated session. */
export type NotificationSigner = {
  publicKey: Uint8Array
  sign: (data: Uint8Array) => Promise<Uint8Array>
  accountUid?: string
}

function normalizeHost(host: string) {
  return host.replace(/\/$/, '')
}

/** Returns the account UID: explicit accountUid if set, otherwise derived from the signing key. */
export function accountIdFromSigner(signer: NotificationSigner | undefined) {
  if (!signer) return undefined
  return signer.accountUid ?? base58btc.encode(signer.publicKey)
}

async function signedNotifPost(host: string, signer: NotificationSigner, payload: Record<string, unknown>) {
  const unsigned = {
    ...payload,
    signer: signer.publicKey,
    time: Date.now(),
    ...(signer.accountUid ? {accountUid: signer.accountUid} : {}),
  }
  const encoded = cborEncode(unsigned)
  const sig = new Uint8Array(await signer.sign(encoded))
  const body = new Uint8Array(cborEncode({...unsigned, sig}))
  const res = await fetch(`${normalizeHost(host)}/hm/api/notifications`, {
    method: 'POST',
    body,
    headers: {'Content-Type': 'application/cbor'},
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const err = await res.json()
      if (err?.error) message = err.error
    } catch {}
    throw new Error(message)
  }
  return res.json()
}

/** Fetches the canonical notification state snapshot for an account. */
export async function getNotificationState(
  notifyServiceHost: string,
  signer: NotificationSigner,
  opts?: {beforeMs?: number; limit?: number},
) {
  return signedNotifPost(notifyServiceHost, signer, {
    action: 'get-notification-state',
    ...(opts?.beforeMs != null ? {beforeMs: opts.beforeMs} : {}),
    limit: opts?.limit ?? DEFAULT_NOTIFICATION_INBOX_LIMIT,
  }) as Promise<NotificationStateSnapshot>
}

/** Applies one or more notification actions on the notify service and returns canonical state. */
export async function applyNotificationActions(
  notifyServiceHost: string,
  signer: NotificationSigner,
  input: {actions: NotificationMutationAction[]; beforeMs?: number; limit?: number},
) {
  return signedNotifPost(notifyServiceHost, signer, {
    action: 'apply-notification-actions',
    actions: input.actions,
    ...(input.beforeMs != null ? {beforeMs: input.beforeMs} : {}),
    limit: input.limit ?? DEFAULT_NOTIFICATION_INBOX_LIMIT,
  }) as Promise<NotificationStateSnapshot>
}
