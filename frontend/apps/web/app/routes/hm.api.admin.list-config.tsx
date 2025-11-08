import {adminSecret, getServiceConfig} from '@/site-config.server'
import {ActionFunction} from 'react-router'
import {z} from 'zod'

const listConfigSchema = z
  .object({
    adminSecret: z.string(),
  })
  .strict()

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return Response.json({message: 'Method not allowed'}, {status: 405})
  }
  const body = await request.json()
  const payload = listConfigSchema.parse(body)
  if (payload.adminSecret !== adminSecret || !adminSecret) {
    return Response.json({message: 'Invalid admin secret'}, {status: 401})
  }
  const serviceConfig = await getServiceConfig()
  if (!serviceConfig) {
    return Response.json({message: 'Service config not found'}, {status: 404})
  }
  return Response.json(serviceConfig)
}
