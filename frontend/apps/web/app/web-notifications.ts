/**
 * Web-specific notification model.
 *
 * Creates a NotificationSigner from the web's local key pair and provides
 * hooks for fetching the inbox, reading/merging read state, and marking
 * notifications as read — all talking directly to the notification server.
 */
import type {NotificationSigner, NotificationReadState} from '@shm/shared/models/notifications'
import {
  useNotificationInbox as useSharedNotificationInbox,
  useNotificationReadState as useSharedNotificationReadState,
  useMergeNotificationReadState,
  useNotificationConfig as useSharedNotificationConfig,
  useSetNotificationConfig as useSharedSetNotificationConfig,
  useResendNotificationConfigVerification as useSharedResendVerification,
  useRemoveNotificationConfig as useSharedRemoveNotificationConfig,
} from '@shm/shared/models/notifications'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {preparePublicKey} from './auth-utils'
import {useLocalKeyPair} from './auth'

function useWebNotifyServiceHost() {
  const keyPair = useLocalKeyPair()
  return keyPair?.notifyServerUrl
}

/**
 * Builds a NotificationSigner from the web's local CryptoKeyPair.
 * Returns undefined until the async public key export resolves.
 */
function useWebNotificationSigner(): NotificationSigner | undefined {
  const keyPair = useLocalKeyPair()
  const [signer, setSigner] = useState<NotificationSigner | undefined>(undefined)

  useEffect(() => {
    if (!keyPair) {
      setSigner(undefined)
      return
    }

    let cancelled = false

    preparePublicKey(keyPair.publicKey)
      .then((publicKey) => {
        if (cancelled) return
        setSigner({
          publicKey,
          sign: async (data: Uint8Array) => {
            const sig = await crypto.subtle.sign(
              {...keyPair.privateKey.algorithm, hash: {name: 'SHA-256'}},
              keyPair.privateKey,
              new Uint8Array(data),
            )
            return new Uint8Array(sig)
          },
          // When the local signing key differs from the account (delegation),
          // tell the server which account we're acting on behalf of.
          accountUid: keyPair.delegatedAccountUid || undefined,
        })
      })
      .catch((err) => {
        console.error('[useWebNotificationSigner] preparePublicKey failed:', err)
      })

    return () => {
      cancelled = true
    }
  }, [keyPair?.delegatedAccountUid, keyPair?.id])

  return signer
}

/** Returns the account UID of the currently signed-in web user. */
export function useWebAccountUid(): string | undefined {
  const keyPair = useLocalKeyPair()
  return keyPair?.delegatedAccountUid ?? keyPair?.id ?? undefined
}

// -- Inbox --------------------------------------------------------------------

/** Fetches the notification inbox from the server. */
export function useWebNotificationInbox() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  return useSharedNotificationInbox(notifyServiceHost, signer)
}

// -- Read state ---------------------------------------------------------------

/** Fetches the notification read state from the server. */
export function useWebNotificationReadState() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  return useSharedNotificationReadState(notifyServiceHost, signer)
}

/** Marks a single notification event as read (merges into server state). */
export function useWebMarkNotificationEventRead() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  const merge = useMergeNotificationReadState(notifyServiceHost, signer)

  return useMutation({
    mutationFn: async (input: {accountUid: string; eventId: string; eventAtMs: number}) => {
      return merge.mutateAsync({
        markAllReadAtMs: null,
        readEvents: [{eventId: input.eventId, eventAtMs: input.eventAtMs}],
      })
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE])
    },
  })
}

/** Marks a single notification event as unread by merging without that event. */
export function useWebMarkNotificationEventUnread() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  const readState = useWebNotificationReadState()
  const merge = useMergeNotificationReadState(notifyServiceHost, signer)

  return useMutation({
    mutationFn: async (input: {
      accountUid: string
      eventId: string
      eventAtMs: number
      otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
    }) => {
      // To "unread" an event we merge the read state without that event.
      // We keep the existing watermark and all other individually-read events.
      const currentEvents = readState.data?.readEvents ?? []
      const filtered = currentEvents.filter((e) => e.eventId !== input.eventId)
      return merge.mutateAsync({
        markAllReadAtMs: readState.data?.markAllReadAtMs ?? null,
        readEvents: filtered,
      })
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE])
    },
  })
}

/** Marks all loaded notifications as read using the watermark approach. */
export function useWebMarkAllNotificationsRead() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  const merge = useMergeNotificationReadState(notifyServiceHost, signer)

  return useMutation({
    mutationFn: async (input: {accountUid: string; markAllReadAtMs: number}) => {
      return merge.mutateAsync({
        markAllReadAtMs: input.markAllReadAtMs,
        readEvents: [],
      })
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.NOTIFICATION_READ_STATE])
    },
  })
}

// -- Email config -------------------------------------------------------------

/** Gets the notification email configuration. */
export function useWebNotificationConfig() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  return useSharedNotificationConfig(notifyServiceHost, signer)
}

/** Sets the notification email configuration. */
export function useWebSetNotificationConfig() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  return useSharedSetNotificationConfig(notifyServiceHost, signer)
}

/** Resends the notification config verification email. */
export function useWebResendNotificationConfigVerification() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  return useSharedResendVerification(notifyServiceHost, signer)
}

/** Removes the notification email configuration. */
export function useWebRemoveNotificationConfig() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  return useSharedRemoveNotificationConfig(notifyServiceHost, signer)
}
