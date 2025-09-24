import {adminSecret, getServiceConfig, writeConfig} from '@/site-config'
import {ActionFunction} from 'react-router'
import {json} from '@/utils/json'
import {randomBytes} from 'crypto'
import {z} from 'zod'

const postServiceSchema = z
  .object({
    name: z.string(),
    adminSecret: z.string(),
  })
  .strict()

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  const data = await request.json()
  const payload = postServiceSchema.parse(data)
  if (payload.adminSecret !== adminSecret || !adminSecret) {
    return json({message: 'Invalid admin secret'}, {status: 401})
  }
  // verify the name is a valid subdomain, no dots, underscores, or special characters
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(payload.name)) {
    return json({message: 'Invalid service name'}, {status: 400})
  }
  const serviceConfig = await getServiceConfig()
  if (!serviceConfig) {
    return json({message: 'Service config not found'}, {status: 404})
  }
  // verify the name is not already taken
  if (serviceConfig.namedServices[payload.name]) {
    return json({message: 'Service name already taken'}, {status: 400})
  }
  // generate a 10 character random secret
  const secret = randomBytes(10).toString('hex').slice(0, 10)
  await writeConfig(`${payload.name}.${serviceConfig.rootHostname}`, {
    availableRegistrationSecret: secret,
  })

  return json({
    message: 'Success',
    secret,
    setupUrl: `https://${payload.name}.${serviceConfig.rootHostname}/hm/register?secret=${secret}`,
  })
}
