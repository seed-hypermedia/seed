import {hmId, queryKeys} from '@shm/shared'
import {SEED_HOST_URL} from '@shm/shared/constants'
import z from 'zod'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
// @ts-expect-error ignore import
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import {seedClient, getSigner} from './app-client'

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
export type PendingDomain = z.infer<typeof PendingDomainSchema>

const PendingSiteMoveSchema = z.object({
  id: z.string(),
  siteUid: z.string(),
  oldName: z.string(),
  newName: z.string(),
  oldUrl: z.string().url(),
  hostUrl: z.string().url(),
  email: z.string(),
})
/** Durable intent lets a hosting move recover after a lost response or desktop restart. */
export type PendingSiteMove = z.infer<typeof PendingSiteMoveSchema>

const HostSchema = z.object({
  authVersion: z.number().int().nonnegative().default(0),
  email: z.string().or(z.null()),
  sessionToken: z.string().or(z.null()),
  pendingSessionToken: z.string().or(z.null()),
  pendingDomains: z.array(PendingDomainSchema).optional(),
  pendingSiteMoves: z.array(PendingSiteMoveSchema).optional(),
})

type HostState = z.infer<typeof HostSchema>

let state: HostState = HostSchema.parse(
  appStore.get(HOST_STORAGE_KEY) || {
    email: null,
    sessionToken: null,
    pendingSessionToken: null,
  },
)

async function writeHostState(newState: HostState) {
  state = newState
  appStore.set(HOST_STORAGE_KEY, newState)
  appInvalidateQueries(['trpc.host.get'])
  appInvalidateQueries([queryKeys.HOST_STATE])
  return undefined
}

export const hostApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),
  setPendingSiteMove: t.procedure.input(PendingSiteMoveSchema).mutation(async ({input}) => {
    const existing = state.pendingSiteMoves?.find((move) => move.id === input.id && move.hostUrl === input.hostUrl)
    if (
      existing &&
      (existing.newName !== input.newName || existing.siteUid !== input.siteUid || existing.email !== input.email)
    ) {
      throw new Error('Finish the pending address change before starting another move.')
    }
    await writeHostState({
      ...state,
      pendingSiteMoves: [
        ...(state.pendingSiteMoves || []).filter((move) => move.id !== input.id || move.hostUrl !== input.hostUrl),
        input,
      ],
    })
  }),
  clearPendingSiteMove: t.procedure.input(z.object({id: z.string(), hostUrl: z.string()})).mutation(async ({input}) => {
    await writeHostState({
      ...state,
      pendingSiteMoves: state.pendingSiteMoves?.filter(
        (move) => move.id !== input.id || move.hostUrl !== input.hostUrl,
      ),
    })
  }),
  logout: t.procedure.mutation(async () => {
    const sessionToken = state.sessionToken
    // Clear persisted credentials first, including while the hosting service is offline.
    await writeHostState({
      authVersion: state.authVersion + 1,
      email: null,
      sessionToken: null,
      pendingSessionToken: null,
      pendingSiteMoves: state.pendingSiteMoves,
    })
    appInvalidateQueries(['HOST_SITES'])
    if (sessionToken) {
      try {
        const response = await fetch(`${SEED_HOST_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {Authorization: `Bearer ${sessionToken}`},
          signal: AbortSignal.timeout(5_000),
        })
        if (!response.ok && response.status !== 401) throw new Error(`Hosting logout failed (${response.status})`)
      } catch (error) {
        console.warn('Hosting credentials cleared locally; remote session revocation unavailable', error)
      }
    }
    return state
  }),
  set: t.procedure
    .input(HostSchema.extend({expectedAuthVersion: z.number().int().nonnegative()}))
    .mutation(async ({input}) => {
      if (input.expectedAuthVersion !== state.authVersion) {
        throw new Error('Hosting session changed. Please sign in again.')
      }
      const {expectedAuthVersion, ...nextState} = input
      await writeHostState({...nextState, authVersion: state.authVersion, pendingSiteMoves: state.pendingSiteMoves})
    }),
})

async function updateSingleDNSStatus(sessionToken: string, pendingDomain: z.infer<typeof PendingDomainSchema>) {
  const resp = await fetch(`${SEED_HOST_URL}/api/domains/${pendingDomain.id}`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  })
  const respJson = await resp.json()
  if (respJson.status === 'WaitingForDNS') {
    await writeDNSStatus(pendingDomain.id, 'waiting-dns')
  } else if (respJson.status === 'Error') {
    await writeDNSStatus(pendingDomain.id, 'error')
  } else if (respJson.status === 'Initializing') {
    await writeDNSStatus(pendingDomain.id, 'initializing')
  } else if (respJson.status === 'Active') {
    await writeDNSActive(pendingDomain)
  }
}

async function writeDNSActive(pendingDomain: PendingDomain) {
  const doc = await grpcClient.documents.getDocument({
    account: pendingDomain.siteUid,
  })
  if (!doc) {
    throw new Error('writeDNSActive: no document found')
  }
  await seedClient.publishDocument(
    {
      account: pendingDomain.siteUid,
      baseVersion: doc.version,
      genesis: doc.genesis,
      generation: doc.generationInfo?.generation,
      changes: [{op: {case: 'setMetadata', value: {key: 'siteUrl', value: `https://${pendingDomain.hostname}`}}}],
    },
    getSigner(pendingDomain.siteUid),
  )
  const entityId = hmId(pendingDomain.siteUid).id
  console.log('~~ Invalidating entity', entityId)
  appInvalidateQueries([queryKeys.ENTITY, entityId])
  appInvalidateQueries([queryKeys.RESOLVED_ENTITY, entityId])
  setTimeout(() => {
    writeHostState({
      ...state,
      pendingDomains: state.pendingDomains?.filter((pending) => pending.id !== pendingDomain.id),
    })
  }, 250) // delay for a bit because it takes a moment for the front end to catch up
}

async function writeDNSStatus(domainId: string, status: PendingDomain['status']) {
  if (
    state.pendingDomains?.find((pending) => {
      return pending.id === domainId && pending.status !== status
    })
  ) {
    writeHostState({
      ...state,
      pendingDomains: state.pendingDomains?.map((pending) => {
        return pending.id === domainId ? {...pending, status} : pending
      }),
    })
  }
}

async function updateDNSStatus() {
  if (!state.sessionToken) return null
  const pendingDomains = state.pendingDomains || []
  for (const pendingDomain of pendingDomains) {
    await updateSingleDNSStatus(state.sessionToken, pendingDomain)
  }
}

function loopDNSStatus() {
  updateDNSStatus()
    .catch((e) => {
      console.error('Error updating DNS Status', e)
    })
    .finally(() => {
      setTimeout(loopDNSStatus, 20_000)
    })
}

loopDNSStatus()
