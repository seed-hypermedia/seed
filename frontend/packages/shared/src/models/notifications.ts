import {useMutation, useQuery} from '@tanstack/react-query'
import {IS_DESKTOP} from '../constants'
import {invalidateQueries} from './query-client'
import type {NotificationInboxResponse} from './notification-payload'
import {queryKeys} from './query-keys'
import {
  accountIdFromSigner,
  applyNotificationActions,
  getNotificationState,
  type NotificationSigner,
} from './notification-service'
import type {
  NotificationConfigState,
  NotificationMutationAction,
  NotificationReadState,
  NotificationStateSnapshot,
} from './notification-state'

const NOTIFICATION_REFETCH_MS = 15_000
const DESKTOP_NOTIFICATION_CONFIG_REFETCH_MS = 30_000
const DESKTOP_UNVERIFIED_NOTIFICATION_CONFIG_REFETCH_MS = 5_000

export type NotificationConfig = NotificationConfigState
export type {NotificationReadState, NotificationMutationAction, NotificationSigner, NotificationStateSnapshot}

function getNotificationStateQueryKey(notifyServiceHost: string | undefined, accountId: string | undefined) {
  return [queryKeys.NOTIFICATION_STATE, notifyServiceHost, accountId]
}

function invalidateNotificationStateQueries(notifyServiceHost: string | undefined, accountId: string | undefined) {
  invalidateQueries(getNotificationStateQueryKey(notifyServiceHost, accountId))
  invalidateQueries([queryKeys.NOTIFICATION_CONFIG, notifyServiceHost, accountId])
  invalidateQueries([queryKeys.NOTIFICATION_READ_STATE, notifyServiceHost, accountId])
  invalidateQueries([queryKeys.NOTIFICATION_INBOX, notifyServiceHost, accountId])
}

/** Fetches the full canonical notification state for an account. */
export function useNotificationState(notifyServiceHost: string | undefined, signer: NotificationSigner | undefined) {
  const accountId = accountIdFromSigner(signer)
  return useQuery({
    queryKey: getNotificationStateQueryKey(notifyServiceHost, accountId),
    queryFn: async (): Promise<NotificationStateSnapshot> => {
      return getNotificationState(notifyServiceHost!, signer!)
    },
    enabled: !!notifyServiceHost && !!signer && !!accountId,
    refetchOnMount: 'always',
    refetchInterval: IS_DESKTOP
      ? (notificationState) =>
          notificationState?.config.email && !notificationState.config.verifiedTime
            ? DESKTOP_UNVERIFIED_NOTIFICATION_CONFIG_REFETCH_MS
            : DESKTOP_NOTIFICATION_CONFIG_REFETCH_MS
      : NOTIFICATION_REFETCH_MS,
    refetchIntervalInBackground: IS_DESKTOP,
  })
}

export function useNotificationConfig(notifyServiceHost: string | undefined, signer: NotificationSigner | undefined) {
  const accountId = accountIdFromSigner(signer)
  return useQuery({
    queryKey: getNotificationStateQueryKey(notifyServiceHost, accountId),
    queryFn: async (): Promise<NotificationStateSnapshot> => {
      return getNotificationState(notifyServiceHost!, signer!)
    },
    select: (state: NotificationStateSnapshot) => state.config,
    enabled: !!notifyServiceHost && !!signer && !!accountId,
    refetchOnMount: 'always',
    refetchInterval: IS_DESKTOP
      ? (config) =>
          config?.email && !config.verifiedTime
            ? DESKTOP_UNVERIFIED_NOTIFICATION_CONFIG_REFETCH_MS
            : DESKTOP_NOTIFICATION_CONFIG_REFETCH_MS
      : NOTIFICATION_REFETCH_MS,
    refetchIntervalInBackground: IS_DESKTOP,
  })
}

export type SetNotificationConfigInput = {
  email: string
}

function useApplyNotificationActions(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
  accountId: string | undefined,
) {
  return useMutation({
    mutationFn: async (actions: NotificationMutationAction[]) => {
      if (!notifyServiceHost || !signer) {
        throw new Error('Missing notifyServiceHost or signer')
      }
      return applyNotificationActions(notifyServiceHost, signer, {actions})
    },
    onSuccess: () => {
      invalidateNotificationStateQueries(notifyServiceHost, accountId)
    },
  })
}

export function useSetNotificationConfig(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const accountId = accountIdFromSigner(signer)
  const mutation = useApplyNotificationActions(notifyServiceHost, signer, accountId)
  return useMutation({
    mutationFn: async (input: SetNotificationConfigInput) => {
      return mutation.mutateAsync([
        {
          type: 'set-config',
          email: input.email,
          createdAtMs: Date.now(),
        },
      ])
    },
  })
}

export function useResendNotificationConfigVerification(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const accountId = accountIdFromSigner(signer)
  const mutation = useApplyNotificationActions(notifyServiceHost, signer, accountId)
  return useMutation({
    mutationFn: async () => {
      return mutation.mutateAsync([
        {
          type: 'resend-config-verification',
          createdAtMs: Date.now(),
        },
      ])
    },
  })
}

export function useRemoveNotificationConfig(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const accountId = accountIdFromSigner(signer)
  const mutation = useApplyNotificationActions(notifyServiceHost, signer, accountId)
  return useMutation({
    mutationFn: async () => {
      return mutation.mutateAsync([{type: 'remove-config'}])
    },
  })
}

export function useNotificationReadState(
  notifyServiceHost: string | undefined,
  signer: NotificationSigner | undefined,
) {
  const accountId = accountIdFromSigner(signer)
  return useQuery({
    queryKey: getNotificationStateQueryKey(notifyServiceHost, accountId),
    queryFn: async (): Promise<NotificationStateSnapshot> => {
      return getNotificationState(notifyServiceHost!, signer!)
    },
    select: (state) => state.readState,
    enabled: !!notifyServiceHost && !!signer && !!accountId,
  })
}

/** Fetches paginated notifications from the notification server. */
export async function getNotificationInbox(
  notifyServiceHost: string,
  signer: NotificationSigner,
  opts?: {beforeMs?: number; limit?: number},
) {
  const state = await getNotificationState(notifyServiceHost, signer, opts)
  return {
    accountId: state.accountId,
    notifications: state.inbox.notifications,
    hasMore: state.inbox.hasMore,
    oldestEventAtMs: state.inbox.oldestEventAtMs,
  } satisfies NotificationInboxResponse
}

/** React-query hook that fetches the notification inbox from the server. */
export function useNotificationInbox(notifyServiceHost: string | undefined, signer: NotificationSigner | undefined) {
  const accountId = accountIdFromSigner(signer)
  return useQuery({
    queryKey: getNotificationStateQueryKey(notifyServiceHost, accountId),
    queryFn: async (): Promise<NotificationStateSnapshot> => {
      return getNotificationState(notifyServiceHost!, signer!)
    },
    select: (state) =>
      ({
        accountId: state.accountId,
        notifications: state.inbox.notifications,
        hasMore: state.inbox.hasMore,
        oldestEventAtMs: state.inbox.oldestEventAtMs,
      }) satisfies NotificationInboxResponse,
    enabled: !!notifyServiceHost && !!signer && !!accountId,
  })
}
