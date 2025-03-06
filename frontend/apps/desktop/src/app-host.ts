import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {appStore} from './app-store'
import {t} from './app-trpc'

const HOST_STORAGE_KEY = 'Host-v001'

const HostSchema = z.object({
  email: z.string().or(z.null()),
  sessionToken: z.string().or(z.null()),
  pendingSessionToken: z.string().or(z.null()),
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
