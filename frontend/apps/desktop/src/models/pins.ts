import {client} from '@/trpc'
import {PinnedDocument, queryKeys} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'

/**
 * Returns the user's pinned documents, optionally filtered to a single site.
 */
export function usePins(siteUid?: string) {
  const pinsQuery = useQuery({
    queryKey: [queryKeys.PINS],
    queryFn: () => client.pins.get.query(),
    enabled: true,
  })
  return useMemo(() => {
    const pins = pinsQuery.data?.pins ?? []
    if (!siteUid) return pins
    return pins.filter((pin) => pin.siteUid === siteUid)
  }, [pinsQuery.data, siteUid])
}

/**
 * Returns all pinned documents across every site.
 */
export function useAllPins() {
  return usePins()
}

function pinInputFromId(id: UnpackedHypermediaId, title: string, seenVersion: string | null): PinnedDocument {
  return {
    siteUid: id.uid,
    path: id.path || [],
    title,
    seenVersion,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Pin or update an existing pin for the given document.
 */
export function usePinDocument() {
  return useMutation({
    mutationFn: (input: {id: UnpackedHypermediaId; title: string; seenVersion: string | null}) =>
      client.pins.pin.mutate(pinInputFromId(input.id, input.title, input.seenVersion)),
    onSuccess: () => {
      invalidateQueries([queryKeys.PINS])
    },
  })
}

/**
 * Remove a pin for the given document.
 */
export function useUnpinDocument() {
  return useMutation({
    mutationFn: (id: UnpackedHypermediaId) => client.pins.unpin.mutate({siteUid: id.uid, path: id.path || []}),
    onSuccess: () => {
      invalidateQueries([queryKeys.PINS])
    },
  })
}

/**
 * Reorder pins within a site by moving a pin from one index to another.
 */
export function useReorderPins() {
  return useMutation({
    mutationFn: (input: {siteUid: string; fromIndex: number; toIndex: number}) => client.pins.reorder.mutate(input),
    onSuccess: () => {
      invalidateQueries([queryKeys.PINS])
    },
  })
}

/**
 * Update a pin to reflect the current document version and title.
 */
export function useAcknowledgePin() {
  return useMutation({
    mutationFn: (input: {id: UnpackedHypermediaId; seenVersion: string | null; title?: string}) =>
      client.pins.acknowledge.mutate({
        siteUid: input.id.uid,
        path: input.id.path || [],
        seenVersion: input.seenVersion,
        title: input.title,
      }),
    onSuccess: () => {
      invalidateQueries([queryKeys.PINS])
    },
  })
}
