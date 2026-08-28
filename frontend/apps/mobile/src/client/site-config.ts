// Site configuration from a hypermedia web server's /hm/api/config endpoint.
// The registeredAccountUid identifies the site's home document (hm://<uid>).

export type SiteConfig = {
  registeredAccountUid: string | null
  peerId?: string
  hostname?: string
  isGateway?: boolean
  /** Notification service base URL announced by the server, when configured. */
  notifyServiceHost?: string | null
}

const CONFIG_TIMEOUT_MS = 10_000

export async function fetchSiteConfig(serverUrl: string): Promise<SiteConfig> {
  // RN fetch has no default timeout; a wedged server must not hang callers.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${serverUrl}/hm/api/config`, {signal: controller.signal})
  } catch (error) {
    throw new Error(`Could not reach ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch site config from ${serverUrl}: ${response.status}`)
  }
  const data = (await response.json()) as SiteConfig & {message?: string}
  if (typeof data !== 'object' || data === null) {
    throw new Error(`Invalid site config response from ${serverUrl}`)
  }
  return {
    registeredAccountUid: data.registeredAccountUid ?? null,
    peerId: data.peerId,
    hostname: data.hostname,
    isGateway: data.isGateway,
    notifyServiceHost: data.notifyServiceHost ?? null,
  }
}
