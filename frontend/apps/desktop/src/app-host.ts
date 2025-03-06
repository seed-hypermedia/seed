import {SEED_HOST_URL} from '@shm/shared/constants'
import fetch from 'node-fetch'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {appStore} from './app-store'
import {t} from './app-trpc'

const HOST_STORAGE_KEY = 'Host-v001'

export const GetDomainResponseSchema = z.object({
  hostname: z.string(),
})
export type GetDomainResponse = z.infer<typeof GetDomainResponseSchema>

const PendingDomainSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    siteUid: z.string(),
    status: z.enum(['waiting-dns', 'initializing', 'error']),
  })
  .strict()

const HostSchema = z.object({
  email: z.string().or(z.null()),
  sessionToken: z.string().or(z.null()),
  pendingSessionToken: z.string().or(z.null()),
  pendingDomains: z.array(PendingDomainSchema).optional(),
})

type HostState = z.infer<typeof HostSchema>

let state: HostState = (appStore.get(HOST_STORAGE_KEY) as HostState) || {
  email: null,
  sessionToken: null,
  pendingSessionToken: null,
}

async function writeHostState(newState: HostState) {
  state = newState
  appStore.set(HOST_STORAGE_KEY, newState)
  appInvalidateQueries(['trpc.host.get'])
  return undefined
}

export const hostApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),
  set: t.procedure.input(HostSchema).mutation(async ({input}) => {
    await writeHostState(input)
  }),
})

async function updateSingleDNSStatus(
  sessionToken: string,
  pendingDomain: z.infer<typeof PendingDomainSchema>,
) {
  console.log('~~ UPDATE DNS STATUS', pendingDomain)
  const resp = await fetch(`${SEED_HOST_URL}/api/domains/${pendingDomain.id}`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  })
  const respJson = await resp.json()
  console.log('~~ UPDATE DNS STATUS RESPONSE', respJson)
}

async function updateDNSStatus() {
  if (!state.sessionToken) return null
  console.log('~~ UPDATE DNS STATUS')
  const pendingDomains = state.pendingDomains || []
  for (const pendingDomain of pendingDomains) {
    await updateSingleDNSStatus(state.sessionToken, pendingDomain)
  }
}

function loopDNSStatus() {
  updateDNSStatus()
    .catch((e) => {
      console.error('~~ UPDATE DNS STATUS ERROR', e)
    })
    .finally(() => {
      setTimeout(loopDNSStatus, 20_000)
    })
}

loopDNSStatus()
