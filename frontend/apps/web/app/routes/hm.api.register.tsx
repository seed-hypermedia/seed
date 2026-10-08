import {grpcClient} from '@/client.server'
import {parseRequest} from '@/request'
import {getConfig, writeConfig} from '@/site-config.server'
import type {ActionFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {z} from 'zod'

const registerSchema = z.object({
  registrationSecret: z.string(),
  accountUid: z.string(),
  peerId: z.string(),
  addrs: z.array(z.string()),
})

// A setup secret authorizes registration; browsers on another Seed origin must
// be able to read both the result and errors without sharing identity cookies.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const action: ActionFunction = async ({request}) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders})
  if (request.method !== 'POST') return json({message: 'Method not allowed'}, {status: 405, headers: corsHeaders})
  const {url, hostname} = parseRequest(request)
  try {
    const data = await request.json()
    console.log('~ REGISTER REQUEST ', data)
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
    const daemonInfo = await grpcClient.daemon.getInfo({})
    // Local hosting can share the publishing daemon; libp2p cannot dial itself.
    const isSameDaemon = !!input.peerId && input.peerId === daemonInfo.peerId
    if (!isSameDaemon) {
      const addrs = input.addrs.map((addr) => `${addr}/p2p/${input.peerId}`)
      console.log('networking.connect', addrs)
      await grpcClient.networking.connect({
        addrs,
      })
    }
    console.log('writing config for', url.hostname)
    await writeConfig(url.hostname, {
      registeredAccountUid: input.accountUid,
      sourcePeerId: input.peerId,
    })
    console.log('Registration Done.')
    return json({message: 'Success'}, {headers: corsHeaders})
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({message}, {status: 500, headers: corsHeaders})
  }
}

export const loader = async ({request}: {request: Request}) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders})
  return json({message: 'Method not allowed'}, {status: 405, headers: corsHeaders})
}
