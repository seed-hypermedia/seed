import type {NavRoute} from '@shm/shared/routes'
import {Suspense, type ReactNode} from 'react'

/** Unmount the outgoing document actor even when the destination suspends during navigation. */
export function NavigationRouteBoundary({
  routeKey,
  fallback,
  children,
}: {
  routeKey: string
  fallback: ReactNode
  children: ReactNode
}) {
  return (
    <Suspense key={routeKey} fallback={fallback}>
      {children}
    </Suspense>
  )
}

/** Collision-free resource identity; versions of a document retain the same editor. */
export function getNavigationResourceKey(route: NavRoute): string {
  if ('id' in route && typeof route.id === 'object') {
    return JSON.stringify(['document', route.id.uid, route.id.path ?? []])
  }
  return JSON.stringify(route)
}
