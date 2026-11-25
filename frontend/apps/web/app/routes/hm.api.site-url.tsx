import {grpcClient} from '@/client.server'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import type {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {SITE_BASE_URL} from '@shm/shared/constants'

const corsHeaders = {'Access-Control-Allow-Origin': '*'}

export type SiteUrlResponse = {
  /** The base URL this web app serves. */
  hostname: string | null
  /** The `siteUrl` the registered space's home document carries; null when there is none. */
  siteUrl: string | null
}

/**
 * The hostname this site serves next to the `siteUrl` its space's home
 * document carries, so `seed-deploy doctor` can tell when they drifted apart
 * (a hostname change not followed by `set-hostname`). Kept out of
 * /hm/api/config on purpose: that route is polled by every daemon that knows
 * the site, and this one loads the whole home document.
 */
export const loader: LoaderFunction = async ({request}) => {
  try {
    const {hostname} = parseRequest(request)
    const config = await getConfig(hostname)
    if (!config) throw new Error(`No config defined for ${hostname}`)
    let siteUrl: string | null = null
    if (config.registeredAccountUid) {
      const home = await grpcClient.documents.getDocument({
        account: config.registeredAccountUid,
        path: '',
        version: undefined,
      })
      const metadata = home.metadata ? (home.metadata.toJson() as Record<string, unknown>) : {}
      if (typeof metadata.siteUrl === 'string') siteUrl = metadata.siteUrl
    }
    const response: SiteUrlResponse = {hostname: SITE_BASE_URL || null, siteUrl}
    return json(response, {headers: corsHeaders})
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({message}, {status: 500, headers: corsHeaders})
  }
}
