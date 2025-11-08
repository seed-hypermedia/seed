import {
  adminSecret,
  getServiceConfig,
  rmCustomDomain,
  rmService,
  siteConfigSchema,
  writeConfig,
  writeCustomDomainConfig,
  type ServiceConfig,
} from '@/site-config.server'
import {ActionFunction} from 'react-router'
import {randomBytes} from 'crypto'
import {z} from 'zod'

const AdminActionCreateService = z
  .object({
    type: z.literal('create-service'),
    name: z.string(),
  })
  .strict()

const AdminActionRemoveService = z
  .object({
    type: z.literal('remove-service'),
    name: z.string(),
  })
  .strict()

const AdminActionCreateCustomDomain = z
  .object({
    type: z.literal('create-custom-domain'),
    hostname: z.string(),
    service: z.string(),
  })
  .strict()

const AdminActionRemoveCustomDomain = z
  .object({
    type: z.literal('remove-custom-domain'),
    hostname: z.string(),
  })
  .strict()

const AdminActionGetConfig = z
  .object({
    type: z.literal('get-config'),
  })
  .strict()

const AdminActionConfigureService = z
  .object({
    type: z.literal('configure-service'),
    name: z.string(),
    config: siteConfigSchema,
  })
  .strict()

const AdminActionSchema = z.discriminatedUnion('type', [
  AdminActionCreateService,
  AdminActionRemoveService,
  AdminActionCreateCustomDomain,
  AdminActionRemoveCustomDomain,
  AdminActionGetConfig,
  AdminActionConfigureService,
])

const AdminActionRequest = z
  .object({
    adminSecret: z.string(),
    adminAction: AdminActionSchema,
  })
  .strict()

type AdminResult = {
  status: number
  data: {
    message?: string
    secret?: string
    setupUrl?: string
    [key: string]: any
  }
}

async function handleCreateService(
  action: z.infer<typeof AdminActionCreateService>,
  serviceConfig: ServiceConfig,
): Promise<AdminResult> {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(action.name)) {
    return {
      status: 400,
      data: {message: 'Invalid service name'},
    }
  }
  if (serviceConfig.namedServices[action.name]) {
    return {
      status: 400,
      data: {message: 'Service name already taken'},
    }
  }
  const secret = randomBytes(10).toString('hex').slice(0, 10)
  await writeConfig(`${action.name}.${serviceConfig.rootHostname}`, {
    availableRegistrationSecret: secret,
  })
  return {
    status: 200,
    data: {
      message: 'Success',
      secret,
      setupUrl: `https://${action.name}.${serviceConfig.rootHostname}/hm/register?secret=${secret}`,
    },
  }
}

async function handleRmService(
  action: z.infer<typeof AdminActionRemoveService>,
): Promise<AdminResult> {
  await rmService(action.name)
  return {
    status: 200,
    data: {message: 'Success'},
  }
}

async function handleCreateCustomDomain(
  action: z.infer<typeof AdminActionCreateCustomDomain>,
  serviceConfig: ServiceConfig,
): Promise<AdminResult> {
  if (!serviceConfig.namedServices[action.service]) {
    return {
      status: 400,
      data: {message: 'Service not found'},
    }
  }
  await writeCustomDomainConfig(action.hostname, action.service)
  return {
    status: 200,
    data: {message: 'Success'},
  }
}

async function handleRmCustomDomain(
  action: z.infer<typeof AdminActionRemoveCustomDomain>,
): Promise<AdminResult> {
  await rmCustomDomain(action.hostname)
  return {
    status: 200,
    data: {message: 'Success'},
  }
}

async function handleGetConfig(
  action: z.infer<typeof AdminActionGetConfig>,
  serviceConfig: ServiceConfig,
): Promise<AdminResult> {
  return {
    status: 200,
    data: serviceConfig,
  }
}

async function handleConfigureService(
  action: z.infer<typeof AdminActionConfigureService>,
  serviceConfig: ServiceConfig,
): Promise<AdminResult> {
  await writeConfig(
    `${action.name}.${serviceConfig.rootHostname}`,
    action.config,
  )
  return {
    status: 200,
    data: {message: 'Success'},
  }
}

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return Response.json({message: 'Method not allowed'}, {status: 405})
  }

  try {
    const data = await request.json()

    const parseResult = AdminActionRequest.safeParse(data)
    if (!parseResult.success) {
      return Response.json(
        {message: 'Invalid request', errors: parseResult.error.errors},
        {status: 400},
      )
    }
    const payload = parseResult.data

    if (payload.adminSecret !== adminSecret || !adminSecret) {
      return Response.json({message: 'Invalid admin secret'}, {status: 401})
    }

    const serviceConfig = await getServiceConfig()
    if (!serviceConfig) {
      return Response.json({message: 'Service config not found'}, {status: 404})
    }

    const action = payload.adminAction
    let result: AdminResult = {
      status: 500,
      data: {message: 'Unhandled action type'},
    }

    switch (action.type) {
      case 'create-service':
        result = await handleCreateService(action, serviceConfig)
        break
      case 'remove-service':
        result = await handleRmService(action)
        break
      case 'create-custom-domain':
        result = await handleCreateCustomDomain(action, serviceConfig)
        break
      case 'remove-custom-domain':
        result = await handleRmCustomDomain(action)
        break
      case 'get-config':
        result = await handleGetConfig(action, serviceConfig)
        break
      case 'configure-service':
        result = await handleConfigureService(action, serviceConfig)
        break
    }

    return Response.json(result.data, {status: result.status})
  } catch (error) {
    console.error('Admin action error:', error)
    return Response.json(
      {message: error instanceof Error ? error.message : 'Unknown error'},
      {status: 500},
    )
  }
}
