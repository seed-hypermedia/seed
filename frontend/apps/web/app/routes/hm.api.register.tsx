import {grpcClient} from '@/client'
import {parseRequest} from '@/request'
import {getConfig, writeConfig} from '@/site-config'
import type {ActionFunction} from 'react-router'
import {json} from '@/utils/json'
import {z} from 'zod'

const registerSchema = z.object({
  registrationSecret: z.string(),
  accountUid: z.string(),
  peerId: z.string(),
  addrs: z.array(z.string()),
})

async function waitFor(check: () => Promise<void>, timeBetweenChecks = 1000) {
  while (true) {
    try {
      await check()
      return
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, timeBetweenChecks))
    }
  }
}

export const action: ActionFunction = async ({request}) => {
  const {url, hostname} = parseRequest(request)
  try {
    const data = await request.json()
    console.log('~ REGISTER REQUEST ', json)
    const input = registerSchema.parse(data)
    const config = await getConfig(hostname)
    if (!config) throw new Error(`No config defined for ${hostname}`)
    if (!config.availableRegistrationSecret) {
      throw {message: 'Registration is not available'}
    }
    if (input.registrationSecret !== config.availableRegistrationSecret) {
      throw {message: 'Invalid registration secret'}
    }
    console.log('REGISTERING SITE', JSON.stringify(input, null, 2))
    const addrs = input.addrs.map((addr) => `${addr}/p2p/${input.peerId}`)
    console.log('networking.connect', addrs)
    await grpcClient.networking.connect({
      addrs,
    })
    console.log('writing config for', url.hostname)
    await writeConfig(url.hostname, {
      registeredAccountUid: input.accountUid,
      sourcePeerId: input.peerId,
    })
    console.log('Registration Done.')
    return json({message: 'Success'})
  } catch (e) {
    // @ts-expect-error
    if (e.toJSON) {
      return json(e, {status: 500})
    } else {
      // @ts-expect-error
      return json({message: e.message}, {status: 500})
    }
  }
}

export const loader = async ({request}: {request: Request}) => {
  return null
}
