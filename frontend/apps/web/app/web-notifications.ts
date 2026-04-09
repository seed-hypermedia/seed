/**
 * Web-specific notification model.
 *
 * Creates a NotificationSigner from the web's local key pair and provides
 * hooks for fetching canonical notification state and applying optimistic
 * notification actions against the notify service.
 */
import {applyNotificationActions, type NotificationSigner} from '@shm/shared/models/notification-service'
import {
  createEmptyNotificationState,
  reduceNotificationState,
  type NotificationMutationAction,
  type NotificationStateSnapshot,
} from '@shm/shared/models/notification-state'
import {
  useNotificationConfig as useSharedNotificationConfig,
  useNotificationInbox as useSharedNotificationInbox,
  useNotificationReadState as useSharedNotificationReadState,
  useNotificationState as useSharedNotificationState,
  useRemoveNotificationConfig as useSharedRemoveNotificationConfig,
  useResendNotificationConfigVerification as useSharedResendVerification,
  useSetNotificationConfig as useSharedSetNotificationConfig,
} from '@shm/shared/models/notifications'
import {invalidateQueries, useQueryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {useLocalKeyPair} from './auth'
import {preparePublicKey, signWithKeyPair} from './auth-utils'

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
          sign: async (data: Uint8Array) => signWithKeyPair(keyPair, new Uint8Array(data)),
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

function getNotificationStateQueryKey(notifyServiceHost: string | undefined, accountId: string | undefined) {
  return [queryKeys.NOTIFICATION_STATE, notifyServiceHost, accountId]
}

function useApplyWebNotificationActions() {
  const notifyServiceHost = useWebNotifyServiceHost()
  const signer = useWebNotificationSigner()
  const accountId = useWebAccountUid()
  const queryClient = useQueryClient()
  const state = useSharedNotificationState(notifyServiceHost, signer)
  const notificationStateQueryKey = getNotificationStateQueryKey(notifyServiceHost, accountId)

  return useMutation({
    mutationFn: async (input: {accountUid: string; actions: NotificationMutationAction[]}) => {
      if (!notifyServiceHost || !signer) {
        throw new Error('Missing notifyServiceHost or signer')
      }
      return applyNotificationActions(notifyServiceHost, signer, {actions: input.actions})
    },
    onMutate: (input) => {
      const previousState = queryClient.getQueryData<NotificationStateSnapshot>(notificationStateQueryKey) ?? state.data
      let optimisticState = previousState
      for (const action of input.actions) {
        const baseState = optimisticState ?? createEmptyNotificationState(input.accountUid)
        optimisticState = reduceNotificationState(baseState, action)
      }
      queryClient.setQueryData(notificationStateQueryKey, optimisticState)
      return {previousState}
    },
    onError: (_error, _input, context) => {
      if (context?.previousState) {
        queryClient.setQueryData(notificationStateQueryKey, context.previousState)
      }
    },
    onSettled: () => {
      invalidateQueries(notificationStateQueryKey)
    },
  })
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

/** Marks a single notification event as read. */
export function useWebMarkNotificationEventRead() {
  const applyActions = useApplyWebNotificationActions()
  return useMutation({
    mutationFn: async (input: {accountUid: string; eventId: string; eventAtMs: number}) => {
      return applyActions.mutateAsync({
        accountUid: input.accountUid,
        actions: [
          {
            type: 'mark-event-read',
            eventId: input.eventId,
            eventAtMs: input.eventAtMs,
          },
        ],
      })
    },
  })
}

/** Marks a single notification event as unread. */
export function useWebMarkNotificationEventUnread() {
  const applyActions = useApplyWebNotificationActions()
  return useMutation({
    mutationFn: async (input: {
      accountUid: string
      eventId: string
      eventAtMs: number
      otherLoadedEvents: Array<{eventId: string; eventAtMs: number}>
    }) => {
      return applyActions.mutateAsync({
        accountUid: input.accountUid,
        actions: [
          {
            type: 'mark-event-unread',
            eventId: input.eventId,
            eventAtMs: input.eventAtMs,
            otherLoadedEvents: input.otherLoadedEvents,
          },
        ],
      })
    },
  })
}

/** Marks all loaded notifications as read using the watermark approach. */
export function useWebMarkAllNotificationsRead() {
  const applyActions = useApplyWebNotificationActions()
  return useMutation({
    mutationFn: async (input: {accountUid: string; markAllReadAtMs: number}) => {
      return applyActions.mutateAsync({
        accountUid: input.accountUid,
        actions: [
          {
            type: 'mark-all-read',
            markAllReadAtMs: input.markAllReadAtMs,
          },
        ],
      })
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
