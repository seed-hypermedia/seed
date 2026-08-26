import {useUniversalAppContext, type UniversalAppContextValue} from '@shm/shared'
import {useNavigation, type NavigationContext} from '@shm/shared/utils/navigation'
import {useLayoutEffect, useSyncExternalStore} from 'react'

/**
 * Hands the current page's site contexts to UI that outlives the page.
 *
 * `WebSiteProvider` — and with it the universal-app context (in-app navigation, origin, file URLs)
 * and the navigation stream (the current route) — is mounted per page, so anything that must
 * survive route changes cannot live inside it. The assistant panel is such a thing: it sits above
 * the outlet so it never remounts, yet it still needs those contexts to open dialogs, follow
 * links, and read the current route for its window context. Each page publishes its contexts here
 * as it mounts; the panel re-provides the latest snapshot to its own subtree. During a transition
 * the previous page's snapshot stays in place until the next page publishes, so the panel is never
 * left without a context, and the route it reads is the page actually on screen.
 */
export type SiteContextSnapshot = {
  universal: UniversalAppContextValue
  navigation: NavigationContext
}

let current: SiteContextSnapshot | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Publishes a snapshot (exported for tests; pages use {@link SiteContextPublisher}). */
export function publishSiteContext(next: SiteContextSnapshot | null) {
  current = next
  listeners.forEach((listener) => listener())
}

/** The latest published site contexts, or null before any page has published. */
export function useSiteContextSnapshot(): SiteContextSnapshot | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}

/** Renders nothing; mount once inside `WebSiteProvider` to publish that page's contexts. */
export function SiteContextPublisher() {
  const universal = useUniversalAppContext()
  const navigation = useNavigation(undefined)
  // Layout effect: publish before paint so the panel reads the new page's route in the same frame
  // the page appears, rather than one frame later.
  useLayoutEffect(() => {
    publishSiteContext({universal, navigation})
  }, [universal, navigation])
  return null
}
