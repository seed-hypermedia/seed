import {hmId, queryKeys} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client'
import {SEED_HOST_URL} from '@shm/shared/constants'
import z from 'zod'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
// @ts-expect-error ignore import
import {appStore} from './app-store.mts'
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
export type PendingDomain = z.infer<typeof PendingDomainSchema>

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
  await grpcClient.documents.createDocumentChange({
    account: pendingDomain.siteUid,
    signingKeyName: pendingDomain.siteUid, // this only works if the signer is available.. we haven't confirmed it but it probably is, if the user has gotten here
    baseVersion: doc.version,
    changes: [
      new DocumentChange({
        op: {
          case: 'setMetadata',
          value: {
            key: 'siteUrl',
            value: `https://${pendingDomain.hostname}`,
          },
        },
      }),
    ],
  })
  const entityId = hmId(pendingDomain.siteUid).id
  console.log('~~ Invalidating entity', entityId)
  appInvalidateQueries([queryKeys.ENTITY, entityId])
  appInvalidateQueries([queryKeys.RESOLVED_ENTITY, entityId])
  setTimeout(() => {
    writeHostState({
      ...state,
      pendingDomains: state.pendingDomains?.filter(
        (pending) => pending.id !== pendingDomain.id,
      ),
    })
  }, 250) // delay for a bit because it takes a moment for the front end to catch up
}

async function writeDNSStatus(
  domainId: string,
  status: PendingDomain['status'],
) {
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
