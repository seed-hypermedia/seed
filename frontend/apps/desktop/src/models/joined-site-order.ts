import {client} from '@/trpc'
import {invalidateQueries, queryKeys, setQueriesDataByKey} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useCallback, useEffect, useMemo, useRef} from 'react'

const JOINED_SITE_ORDER_KEY = 'joined-site-order-v001'

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** Parses a persisted joined-site order, returning null when no valid custom order exists. */
export function parseJoinedSiteOrder(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.length > 0)) return null
  return Array.from(new Set(value as string[]))
}

/** Selects an order only when it belongs to the identity represented by the active query key. */
export function selectJoinedSiteOrder(value: unknown, isPreviousIdentityData: boolean): string[] | null {
  return isPreviousIdentityData ? null : parseJoinedSiteOrder(value)
}

/** Reconciles a custom order with the current authoritative joined-site ids. */
export function reconcileJoinedSiteOrder(
  sourceOrder: string[],
  storedOrder: string[] | null,
): {order: string[]; shouldPersist: boolean} {
  if (!storedOrder) return {order: sourceOrder, shouldPersist: false}

  const joined = new Set(sourceOrder)
  const stored = storedOrder.filter((siteUid) => joined.has(siteUid))
  const storedSet = new Set(stored)
  const added = sourceOrder.filter((siteUid) => !storedSet.has(siteUid))
  const order = [...added, ...stored]
  return {order, shouldPersist: !arraysEqual(order, storedOrder)}
}

/** Moves a joined site before an upward target or after a downward target. */
export function reorderJoinedSites(order: string[], sourceUid: string, targetUid: string): string[] | null {
  const from = order.indexOf(sourceUid)
  const target = order.indexOf(targetUid)
  if (from === -1 || target === -1 || from === target) return null

  const next = [...order]
  const [moved] = next.splice(from, 1)
  const targetAfterRemoval = next.indexOf(targetUid)
  next.splice(from < target ? targetAfterRemoval + 1 : targetAfterRemoval, 0, moved)
  return next
}

/** Creates a writer that completes persistence requests in the same order they were requested. */
export function createJoinedSiteOrderWriter(write: (order: string[]) => Promise<void>) {
  let queue = Promise.resolve()
  return (order: string[]) => {
    const result = queue.then(() => write(order))
    queue = result.catch(() => undefined)
    return result
  }
}

function getJoinedSiteOrderKey(identityUid: string) {
  return `${JOINED_SITE_ORDER_KEY}:${identityUid}`
}

/** Loads, reconciles, and persists the manual Joined Spaces order for one identity. */
export function useJoinedSiteOrder({
  identityUid,
  sourceOrder,
  isAuthoritative,
}: {
  identityUid: string | null | undefined
  sourceOrder: string[]
  isAuthoritative: boolean
}) {
  const settingKey = identityUid ? getJoinedSiteOrderKey(identityUid) : null
  const query = useQuery({
    queryKey: [queryKeys.SETTINGS, settingKey],
    enabled: !!settingKey,
    queryFn: () => client.appSettings.getSetting.query(settingKey!),
  })
  const storedOrder = selectJoinedSiteOrder(query.data, query.isPreviousData)
  const reconciled = useMemo(
    () => reconcileJoinedSiteOrder(sourceOrder, storedOrder),
    [sourceOrder.join('\0'), storedOrder?.join('\0')],
  )
  const writersRef = useRef(new Map<string, ReturnType<typeof createJoinedSiteOrderWriter>>())
  const latestOrdersRef = useRef(new Map<string, string[]>())
  const mutation = useMutation({
    mutationFn: ({key, order}: {key: string; order: string[]}) => {
      let writer = writersRef.current.get(key)
      if (!writer) {
        writer = createJoinedSiteOrderWriter((nextOrder) =>
          client.appSettings.setSetting.mutate({key, value: nextOrder}),
        )
        writersRef.current.set(key, writer)
      }
      return writer(order)
    },
    onMutate: ({key, order}) => {
      latestOrdersRef.current.set(key, order)
      setQueriesDataByKey([queryKeys.SETTINGS, key], order)
    },
    onError: (_error, {key, order}) => {
      if (arraysEqual(latestOrdersRef.current.get(key) ?? [], order)) {
        invalidateQueries([queryKeys.SETTINGS, key])
      }
    },
  })

  useEffect(() => {
    if (
      !settingKey ||
      !isAuthoritative ||
      query.isInitialLoading ||
      query.isPreviousData ||
      !storedOrder ||
      !reconciled.shouldPersist
    )
      return
    mutation.mutate({key: settingKey, order: reconciled.order})
  }, [
    isAuthoritative,
    query.isInitialLoading,
    query.isPreviousData,
    reconciled.order.join('\0'),
    reconciled.shouldPersist,
    settingKey,
  ])

  const persistOrder = useCallback(
    (order: string[]) => {
      if (!settingKey || arraysEqual(order, reconciled.order)) return
      mutation.mutate({key: settingKey, order})
    },
    [reconciled.order.join('\0'), settingKey],
  )

  return {
    order: reconciled.order,
    hasCustomOrder: storedOrder !== null,
    persistOrder,
  }
}
