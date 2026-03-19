import {type NavRoute} from '@shm/shared/routes'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {createAppWindow, getFocusedWindow} from './app-windows'

const defaultRouteNavigationDeps = {
  createAppWindow,
  getFocusedWindow,
}

/**
 * Opens a desktop route in the focused window when possible, or in a new window.
 */
export function openDesktopRoute(
  route: NavRoute,
  options: {newWindow?: boolean} = {},
  deps = defaultRouteNavigationDeps,
): 'current-window' | 'new-window' {
  if (options.newWindow) {
    deps.createAppWindow({routes: [route], routeIndex: 0})
    return 'new-window'
  }

  const focusedWindow = deps.getFocusedWindow()
  if (focusedWindow) {
    focusedWindow.webContents.send('open_route', route)
    return 'current-window'
  }

  deps.createAppWindow({routes: [route], routeIndex: 0})
  return 'new-window'
}

/**
 * Resolves a Hypermedia URL and opens the matching desktop route.
 */
export function navigateDesktopUrl(
  url: string,
  options: {newWindow?: boolean} = {},
  deps = defaultRouteNavigationDeps,
): string {
  const route = hypermediaUrlToRoute(url)
  if (!route) {
    return `Error: Could not parse "${url}" as a Hypermedia route.`
  }

  const destination = openDesktopRoute(route, options, deps)
  const routeLabel = describeRoute(route)
  if (destination === 'new-window') {
    return `Opened ${routeLabel} in a new window.`
  }
  return `Opened ${routeLabel} in the current window.`
}

function describeRoute(route: NavRoute): string {
  switch (route.key) {
    case 'document':
      return 'document'
    case 'comments':
      return route.openComment ? 'comment thread' : 'comments view'
    case 'activity':
      return 'activity view'
    case 'collaborators':
      return 'collaborators view'
    case 'directory':
      return 'directory view'
    case 'feed':
      return 'feed view'
    case 'site-profile':
      return `${route.tab} view`
    default:
      return `${route.key} view`
  }
}
