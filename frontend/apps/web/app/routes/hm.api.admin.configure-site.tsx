import {
  adminSecret,
  getServiceConfig,
  siteConfigSchema,
  writeConfig,
} from '@/site-config.server'
import {ActionFunction} from 'react-router'
import {z} from 'zod'

const postServiceSchema = z
  .object({
    name: z.string(),
    adminSecret: z.string(),
    config: siteConfigSchema,
  })
  .strict()

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return Response.json({message: 'Method not allowed'}, {status: 405})
  }
  const body = await request.json()
  const payload = postServiceSchema.parse(body)
  if (payload.adminSecret !== adminSecret || !adminSecret) {
    return Response.json({message: 'Invalid admin secret'}, {status: 401})
  }
  const serviceConfig = await getServiceConfig()
  if (!serviceConfig) {
    return Response.json({message: 'Service config not found'}, {status: 404})
  }

  await writeConfig(
    `${payload.name}.${serviceConfig.rootHostname}`,
    payload.config,
  )

  return Response.json({
    message: 'Success',
  })
}
