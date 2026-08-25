import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {PrefetchPageLinks} from '@remix-run/react'
import {routeToHref} from '@shm/shared'
import {type ReactNode, useCallback, useState} from 'react'

/** Prefetches each document route requested by its render child once. */
export function WebDocumentPrefetch({
  originHomeId,
  children,
}: {
  originHomeId?: UnpackedHypermediaId
  children: (onPrefetch: (id: UnpackedHypermediaId) => void) => ReactNode
}) {
  const [pages, setPages] = useState<string[]>([])
  const onPrefetch = useCallback(
    (id: UnpackedHypermediaId) => {
      const href = routeToHref({key: 'document', id}, {originHomeId})
      if (!href) return
      setPages((current) => (current.includes(href) ? current : [...current, href]))
    },
    [originHomeId],
  )

  return (
    <>
      {children(onPrefetch)}
      {pages.map((page) => (
        <PrefetchPageLinks key={page} page={page} />
      ))}
    </>
  )
}
