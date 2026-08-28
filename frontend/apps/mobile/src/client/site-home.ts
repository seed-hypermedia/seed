import {fetchSiteConfig} from './site-config'

// The uid of each server's registered site, cached per server URL. Every
// document page (the site home included) is reached through this uid, so it is
// resolved once per server rather than on every navigation.
const homeUidByServer = new Map<string, string>()

export async function resolveSiteHomeUid(serverUrl: string): Promise<string> {
  const cached = homeUidByServer.get(serverUrl)
  if (cached) return cached
  const config = await fetchSiteConfig(serverUrl)
  if (!config.registeredAccountUid) {
    throw new Error('This server has no registered site.')
  }
  homeUidByServer.set(serverUrl, config.registeredAccountUid)
  return config.registeredAccountUid
}
