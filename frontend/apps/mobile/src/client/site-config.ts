// Site configuration from a hypermedia web server's /hm/api/config endpoint.
// The registeredAccountUid identifies the site's home document (hm://<uid>).

export type SiteConfig = {
  registeredAccountUid: string | null
  peerId?: string
  hostname?: string
  isGateway?: boolean
}

export async function fetchSiteConfig(serverUrl: string): Promise<SiteConfig> {
  const response = await fetch(`${serverUrl}/hm/api/config`)
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
  }
}
