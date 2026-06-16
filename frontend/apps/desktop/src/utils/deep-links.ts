import type {AppWindowEvent} from './window-events'

/**
 * Parses the provided URL to determine if it's a deep link,
 * in which case a window event is returned later needs to be fired by the caller.
 */
export function parseDeepLink(url: string): AppWindowEvent | undefined {
  const connectionRegexp = /^hm:\/\/connect\/([\w\-\+]+)$/
  const parsedConnectUrl = url.match(connectionRegexp)
  if (parsedConnectUrl) {
    return {
      type: 'connectPeer',
      connectionUrl: url,
    }
  }

  return undefined
}
