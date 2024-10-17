import {createContext, useContext} from 'react'
import {GestureResponderEvent} from 'react-native'
import {NavRoute} from './routes'
import {idToUrl, UnpackedHypermediaId} from './utils'

type UniversalRoutingContextValue = {
  openRoute: (route: NavRoute) => void
}

const UniversalRoutingContext =
  createContext<UniversalRoutingContextValue | null>(null)

export const UniversalRoutingProvider = UniversalRoutingContext.Provider

export function useOpenRoute() {
  const context = useContext(UniversalRoutingContext)
  if (!context)
    throw new Error('useOpenRoute must be used in a UniversalRoutingProvider')
  return (route: NavRoute) => {
    context.openRoute(route)
  }
}

export function useRouteLink(
  route: NavRoute,
  siteHomeId?: UnpackedHypermediaId,
) {
  const context = useContext(UniversalRoutingContext)
  const href =
    route.key === 'document' ? idToUrl(route.id, {siteHomeId}) : undefined
  if (!context)
    throw new Error('useRouteLink must be used in a UniversalRoutingProvider')
  return {
    onPress: context.openRoute
      ? (e: GestureResponderEvent) => {
          e.preventDefault()
          e.stopPropagation()
          context.openRoute(route)
        }
      : undefined,
    href: href || undefined,
    style: {
      textDecoration: 'none',
    },
    tag: 'a',
  }
}
