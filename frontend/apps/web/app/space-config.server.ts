import {grpcClient} from '@/client.server'
import {SITE_BASE_URL} from '@shm/shared/constants'
import {readFileSync} from 'fs'
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

export const spaceConfigSchema = z.object({
  availableRegistrationSecret: z.string().optional(),
  sourcePeerId: z.string().optional(),
  registeredAccountUid: z.string().optional(),
})
export type SpaceConfig = z.infer<typeof spaceConfigSchema>

const customDomainConfigSchema = z.object({
  service: z.string(),
})
export type CustomDomainConfig = z.infer<typeof customDomainConfigSchema>

const serviceConfigSchema = z.object({
  rootHostname: z.string(),
  rootConfig: spaceConfigSchema,
  namedServices: z.record(z.string(), spaceConfigSchema),
  customDomains: z.record(z.string(), customDomainConfigSchema).optional(),
})
export type ServiceConfig = z.infer<typeof serviceConfigSchema>

export {customDomainConfigSchema, serviceConfigSchema}

let singleSpaceConfig: SpaceConfig | null = null
let singleSpaceConfigError: string | null = null
try {
  const configData = readFileSync(configPath, 'utf-8')
  const configJSON = JSON.parse(configData)
  singleSpaceConfig = spaceConfigSchema.parse(configJSON)
} catch (e: any) {
  singleSpaceConfigError = e.message
}

let serviceConfig: ServiceConfig | null = null
try {
  const serviceConfigData = readFileSync(serviceConfigPath, 'utf-8')
  const serviceConfigJSON = JSON.parse(serviceConfigData)
  serviceConfig = serviceConfigSchema.parse(serviceConfigJSON)
} catch (e: any) {}

if (serviceConfig) {
  console.log('Service config loaded.')
} else if (singleSpaceConfig) {
  console.log('Single space config loaded.')
} else {
  console.error('Config error: ', singleSpaceConfigError)
  throw new Error('Failed to load configuration. Set DATA_DIR/config.json or DATA_DIR/service-config.json')
}

export async function getConfig(hostname: string) {
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
    return singleSpaceConfig
  }
}

export async function getServiceConfig() {
  return serviceConfig
}

export async function writeConfig(hostname: string, newConfig: SpaceConfig) {
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
  const spaceAccounts = new Set<string>()
  if (serviceConfig) {
    Object.values(serviceConfig.namedServices).forEach((config: SpaceConfig) => {
      if (config.registeredAccountUid) spaceAccounts.add(config.registeredAccountUid)
    })
    if (serviceConfig.rootConfig.registeredAccountUid) spaceAccounts.add(serviceConfig.rootConfig.registeredAccountUid)
  } else if (singleSpaceConfig) {
    if (singleSpaceConfig.registeredAccountUid) spaceAccounts.add(singleSpaceConfig.registeredAccountUid)
  } else {
    throw new Error('No space config loaded!')
  }
  const subs = await grpcClient.subscriptions.listSubscriptions({})
  const toUnsubscribe: {account: string; path: string}[] = []
  subs.subscriptions.forEach((sub) => {
    if (!spaceAccounts.has(sub.account) || sub.path !== '') toUnsubscribe.push({account: sub.account, path: sub.path})
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
  spaceAccounts.forEach((account) => {
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
  if (!serviceConfig) throw new Error('Service config not loaded')
  const customDomains = {...serviceConfig.customDomains}
  delete customDomains[hostname]
  await writeServiceConfig({
    ...serviceConfig,
    customDomains,
  })
}

export async function rmService(name: string) {
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

export async function writeSoloConfig(newConfig: SpaceConfig) {
  await fs.writeFile(configPath, JSON.stringify(newConfig))
  singleSpaceConfig = newConfig
}

export async function writeServiceConfig(newConfig: ServiceConfig) {
  await fs.writeFile(serviceConfigPath, JSON.stringify(newConfig))
  serviceConfig = newConfig
}

export async function reloadServiceConfig() {
  const serviceConfigData = await readFile(serviceConfigPath, 'utf-8')
  const serviceConfigJSON = JSON.parse(serviceConfigData)
  serviceConfig = serviceConfigSchema.parse(serviceConfigJSON)
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
