import {grpcClient} from '@/client.server'
import {SITE_BASE_URL} from '@shm/shared/constants'
import {readFileSync, statSync} from 'fs'
import fs, {readFile} from 'fs/promises'
import {join} from 'path'
import {z} from 'zod'

export const adminSecret = process.env.SERVICE_ADMIN_SECRET

const webDataDir = process.env.DATA_DIR || process.cwd()
console.log('~~ process.env.DATA_DIR DATA_DIR', process.env.DATA_DIR)
console.log('~~ process.env.DATA_DIR webDataDir', webDataDir)
console.log('~~ process.env.DATA_DIR cwd', process.cwd())
const configPath = join(webDataDir, 'config.json')
const serviceConfigPath = join(webDataDir, 'service-config.json')

export const siteConfigSchema = z.object({
  availableRegistrationSecret: z.string().optional(),
  sourcePeerId: z.string().optional(),
  registeredAccountUid: z.string().optional(),
})
export type SiteConfig = z.infer<typeof siteConfigSchema>

const customDomainConfigSchema = z.object({
  service: z.string(),
})
export type CustomDomainConfig = z.infer<typeof customDomainConfigSchema>

const serviceConfigSchema = z.object({
  rootHostname: z.string(),
  rootConfig: siteConfigSchema,
  namedServices: z.record(z.string(), siteConfigSchema),
  customDomains: z.record(z.string(), customDomainConfigSchema).optional(),
})
export type ServiceConfig = z.infer<typeof serviceConfigSchema>

export {customDomainConfigSchema, serviceConfigSchema}

let singleSiteConfig: SiteConfig | null = null
let singleSiteConfigError: string | null = null
try {
  const configData = readFileSync(configPath, 'utf-8')
  const configJSON = JSON.parse(configData)
  singleSiteConfig = siteConfigSchema.parse(configJSON)
} catch (e: any) {
  singleSiteConfigError = e.message
}

let serviceConfig: ServiceConfig | null = null
try {
  const serviceConfigData = readFileSync(serviceConfigPath, 'utf-8')
  const serviceConfigJSON = JSON.parse(serviceConfigData)
  serviceConfig = serviceConfigSchema.parse(serviceConfigJSON)
} catch (e: any) {}

// Several web processes can serve one data dir, and any of them may write the
// config (/hm/api/admin, register, bootstrap). Each process re-reads a file
// when its mtime moves, checked at most once per CONFIG_REFRESH_MS on reads and
// always before a write, so a write is never based on a stale copy and other
// processes pick it up within a second.
const CONFIG_REFRESH_MS = 1000
const loadedMtimes = new Map<string, number>()
let lastRefreshCheck = 0

function fileMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

for (const path of [configPath, serviceConfigPath]) {
  const mtime = fileMtime(path)
  if (mtime !== null) loadedMtimes.set(path, mtime)
}

async function refreshConfigFromDisk(opts: {force?: boolean} = {}) {
  const now = Date.now()
  if (!opts.force && now - lastRefreshCheck < CONFIG_REFRESH_MS) return
  lastRefreshCheck = now
  for (const path of serviceConfig ? [serviceConfigPath] : [configPath, serviceConfigPath]) {
    const mtime = fileMtime(path)
    if (mtime === null || mtime === loadedMtimes.get(path)) continue
    try {
      const data = JSON.parse(await readFile(path, 'utf-8'))
      if (path === serviceConfigPath) serviceConfig = serviceConfigSchema.parse(data)
      else singleSiteConfig = siteConfigSchema.parse(data)
      loadedMtimes.set(path, mtime)
    } catch (e) {
      // Keep serving the last good config; the next check retries.
      console.error(`Failed to reload ${path}:`, e instanceof Error ? e.message : e)
    }
  }
}

/** Write via a temp file and rename, so a concurrent reader never sees a partial file. */
async function writeJsonAtomic(path: string, value: unknown) {
  const tmpPath = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(value))
  await fs.rename(tmpPath, path)
  const mtime = fileMtime(path)
  if (mtime !== null) loadedMtimes.set(path, mtime)
}

if (serviceConfig) {
  console.log('Service config loaded.')
} else if (singleSiteConfig) {
  console.log('Single site config loaded.')
} else {
  console.error('Config error: ', singleSiteConfigError)
  throw new Error('Failed to load configuration. Set DATA_DIR/config.json or DATA_DIR/service-config.json')
}

export async function getConfig(hostname: string) {
  await refreshConfigFromDisk()
  // the service config takes precedence over the regular config
  if (serviceConfig) {
    if (hostname === serviceConfig.rootHostname) return serviceConfig.rootConfig
    if (serviceConfig.customDomains && serviceConfig.customDomains[hostname]) {
      const customDomain = serviceConfig.customDomains[hostname]
      if (customDomain.service && serviceConfig.namedServices[customDomain.service]) {
        return serviceConfig.namedServices[customDomain.service] || null
      }
    }
    // if the hostname isn't in the format subdomain.rootHostname, return nothing
    const parts = hostname.split('.')
    const rootParts = serviceConfig.rootHostname.split('.')
    if (parts.length !== rootParts.length + 1) return null
    if (parts.slice(1).join('.') !== serviceConfig.rootHostname) return null
    // get the subdomain (without the dot)
    const subdomain = parts[0]
    // return the named service config
    // @ts-expect-error
    return serviceConfig.namedServices[subdomain] || null
  } else {
    return singleSiteConfig
  }
}

export async function getServiceConfig() {
  await refreshConfigFromDisk()
  return serviceConfig
}

export async function writeConfig(hostname: string, newConfig: SiteConfig) {
  await refreshConfigFromDisk({force: true})
  if (serviceConfig) {
    if (hostname === serviceConfig.rootHostname) {
      const newServiceConfig = {
        ...serviceConfig,
        rootConfig: newConfig,
      }
      await writeServiceConfig(newServiceConfig)
    } else {
      let subdomain: string | null = null
      if (serviceConfig.customDomains && serviceConfig.customDomains[hostname]) {
        subdomain = serviceConfig.customDomains[hostname].service
      } else {
        // split hostname into parts and validate format subdomain.rootHostname
        const parts = hostname.split('.')
        const rootParts = serviceConfig.rootHostname.split('.')
        if (parts.length !== rootParts.length + 1 || parts.slice(1).join('.') !== serviceConfig.rootHostname) {
          throw new Error(
            `Cannot write to service config for hostname ${hostname} - must be in format [subdomain].${serviceConfig.rootHostname}`,
          )
        }
        // @ts-expect-error
        subdomain = parts[0]
      }
      if (!subdomain) throw new Error('Invalid hostname')
      const newServiceConfig = {
        ...serviceConfig,
        namedServices: {
          ...serviceConfig.namedServices,
          [subdomain]: newConfig,
        },
      }
      await writeServiceConfig(newServiceConfig)
    }
  } else {
    await writeSoloConfig(newConfig)
  }
  await applyConfigSubscriptions()
}

export async function applyConfigSubscriptions() {
  const siteAccounts = new Set<string>()
  if (serviceConfig) {
    Object.values(serviceConfig.namedServices).forEach((config: SiteConfig) => {
      if (config.registeredAccountUid) siteAccounts.add(config.registeredAccountUid)
    })
    if (serviceConfig.rootConfig.registeredAccountUid) siteAccounts.add(serviceConfig.rootConfig.registeredAccountUid)
  } else if (singleSiteConfig) {
    if (singleSiteConfig.registeredAccountUid) siteAccounts.add(singleSiteConfig.registeredAccountUid)
  } else {
    throw new Error('No site config loaded!')
  }
  const subs = await grpcClient.subscriptions.listSubscriptions({})
  const toUnsubscribe: {account: string; path: string}[] = []
  subs.subscriptions.forEach((sub) => {
    if (!siteAccounts.has(sub.account) || sub.path !== '') toUnsubscribe.push({account: sub.account, path: sub.path})
  })
  await Promise.all(
    toUnsubscribe.map(async ({account, path}) => {
      console.log('Unsubscribing from ', account, path)
      await grpcClient.subscriptions.unsubscribe({
        account,
        path,
      })
    }),
  )
  const toSubscribe: {account: string}[] = []
  siteAccounts.forEach((account) => {
    if (!subs.subscriptions.some((sub) => sub.account === account && sub.path === '')) toSubscribe.push({account})
  })
  await Promise.all(
    toSubscribe.map(async ({account}) => {
      console.log('Subscribing to ', account)
      await grpcClient.subscriptions.subscribe({
        account,
        path: '',
        recursive: true,
      })
    }),
  )
}

export async function writeCustomDomainConfig(hostname: string, serviceName: string) {
  await refreshConfigFromDisk({force: true})
  if (!serviceConfig) throw new Error('Service config not loaded')
  await writeServiceConfig({
    ...serviceConfig,
    customDomains: {
      ...serviceConfig.customDomains,
      [hostname]: {service: serviceName},
    },
  })
}

export async function rmCustomDomain(hostname: string) {
  await refreshConfigFromDisk({force: true})
  if (!serviceConfig) throw new Error('Service config not loaded')
  const customDomains = {...serviceConfig.customDomains}
  delete customDomains[hostname]
  await writeServiceConfig({
    ...serviceConfig,
    customDomains,
  })
}

export async function rmService(name: string) {
  await refreshConfigFromDisk({force: true})
  if (!serviceConfig) throw new Error('Service config not loaded')
  if (!serviceConfig.namedServices[name]) throw new Error(`Service ${name} not found`)
  const namedServices = {...serviceConfig.namedServices}
  delete namedServices[name]
  await writeServiceConfig({
    ...serviceConfig,
    namedServices,
    // also remove any custom domains that point to this service
    customDomains: Object.fromEntries(
      Object.entries(serviceConfig.customDomains || {}).filter(
        ([_, customDomain]) => customDomain && customDomain.service !== name,
      ),
    ),
  })
}

export async function writeSoloConfig(newConfig: SiteConfig) {
  await writeJsonAtomic(configPath, newConfig)
  singleSiteConfig = newConfig
}

export async function writeServiceConfig(newConfig: ServiceConfig) {
  await writeJsonAtomic(serviceConfigPath, newConfig)
  serviceConfig = newConfig
}

export async function reloadServiceConfig() {
  const serviceConfigData = await readFile(serviceConfigPath, 'utf-8')
  const serviceConfigJSON = JSON.parse(serviceConfigData)
  serviceConfig = serviceConfigSchema.parse(serviceConfigJSON)
  const mtime = fileMtime(serviceConfigPath)
  if (mtime !== null) loadedMtimes.set(serviceConfigPath, mtime)
}

export function getHostnames() {
  if (serviceConfig) {
    const rootHostname = serviceConfig.rootHostname
    return [
      rootHostname,
      ...Object.keys(serviceConfig.namedServices).map((subdomain) => `${subdomain}.${rootHostname}`),
    ]
  }
  const baseDomainWithPort = SITE_BASE_URL?.split('://')[1]
  const baseDomain = baseDomainWithPort?.split(':')[0]
  if (!baseDomain) return []
  return [baseDomain]
}
