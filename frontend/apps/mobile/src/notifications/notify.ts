/**
 * Notification-server integration (the same signed /hm/api/notifications CBOR
 * API desktop and web use). The signing key IS the account: requests are
 * signed with the vault identity's ed25519 key and accountUid is omitted, so
 * the notify server derives the account id from the signer principal.
 */

import {
  applyNotificationActions,
  getNotificationState,
  type NotificationSigner,
} from '@shm/shared/models/notification-service'
import type {NotificationMutationAction, NotificationStateSnapshot} from '@shm/shared/models/notification-state'
import {fetchSiteConfig} from '../client/site-config'
import {getCurrentServer} from '../store/server-store'
import {getVaultManager} from '../vault'

export const DEFAULT_NOTIFY_HOST = 'https://notify.seed.hyper.media'

/**
 * Desktop-parity resolution order: vault-synced notificationServerUrl →
 * the connected server's announced notifyServiceHost → the public default.
 */
export async function resolveNotifyHost(): Promise<string> {
  const manager = await getVaultManager()
  const vaultUrl = manager.getNotificationServerUrl()
  if (vaultUrl) return vaultUrl
  try {
    const config = await fetchSiteConfig(getCurrentServer().url)
    if (config.notifyServiceHost) return config.notifyServiceHost
  } catch {
    // The server may be unreachable or have no config — fall through.
  }
  return DEFAULT_NOTIFY_HOST
}

/** Build a notify-service signer from a vault identity. */
export async function notificationSignerFor(accountId: string): Promise<NotificationSigner> {
  const manager = await getVaultManager()
  const signer = manager.getSigner(accountId)
  return {
    publicKey: new Uint8Array(await signer.getPublicKey()),
    sign: (data) => signer.sign(data),
  }
}

const REQUEST_TIMEOUT_MS = 15_000

/** RN fetch has no default timeout — an unreachable notify host must surface
 * an error instead of leaving the notifications screen loading forever. */
function withTimeout<T>(promise: Promise<T>, host: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Notification server not responding (${host})`)),
      REQUEST_TIMEOUT_MS,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function fetchNotificationState(accountId: string, host?: string): Promise<NotificationStateSnapshot> {
  const notifyHost = host ?? (await resolveNotifyHost())
  const signer = await notificationSignerFor(accountId)
  return withTimeout(getNotificationState(notifyHost, signer), notifyHost)
}

export async function applyNotificationMutations(
  accountId: string,
  actions: NotificationMutationAction[],
  host?: string,
): Promise<NotificationStateSnapshot> {
  const notifyHost = host ?? (await resolveNotifyHost())
  const signer = await notificationSignerFor(accountId)
  return withTimeout(applyNotificationActions(notifyHost, signer, {actions}), notifyHost)
}
