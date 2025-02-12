import {createContext, PropsWithChildren, useContext} from 'react'
import {GestureResponderEvent} from 'react-native'
import {NavRoute} from './routes'
import {idToUrl, UnpackedHypermediaId} from './utils'

type UniversalRoutingContextValue = {
  openRoute: (route: NavRoute, replace?: boolean) => void
  siteHomeId?: UnpackedHypermediaId | null
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

export function SiteRoutingProvider({
  homeId,
  children,
}: PropsWithChildren<{
  homeId?: UnpackedHypermediaId | null
}>) {
  const context = useContext(UniversalRoutingContext)
  return (
    <UniversalRoutingProvider
      value={{
        ...(context || {
          openRoute: () => {},
        }),
        siteHomeId: homeId,
      }}
    >
      {children}
    </UniversalRoutingProvider>
  )
}

export function useRouteLink(
  route: NavRoute | null,
  siteHomeId?: UnpackedHypermediaId,
  opts?: {
    replace?: boolean
  },
) {
  const context = useContext(UniversalRoutingContext)

  if (!route)
    return {
      onPress: undefined,
      href: undefined,
      style: {textDecoration: 'none'},
      tag: 'a',
    }
  const href =
    route.key == 'document'
      ? idToUrl(route.id, {siteHomeId: siteHomeId || context?.siteHomeId})
      : undefined
  if (!context)
    throw new Error('useRouteLink must be used in a UniversalRoutingProvider')
  return {
    onPress: context.openRoute
      ? (e: GestureResponderEvent) => {
          e.preventDefault()
          e.stopPropagation()
          context.openRoute(route, opts?.replace)
        }
      : undefined,
    href: href || '/',
    style: {
      textDecoration: 'none',
    },
    tag: 'a',
  }
}
