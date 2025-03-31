import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const EXPERIMENTS_STORAGE_KEY = 'Experiments-v001'

const experimentsZ = z
  .object({
    hosting: z.boolean().optional(),
    webImporting: z.boolean().optional(),
    nostr: z.boolean().optional(),
    developerTools: z.boolean().optional(),
    pubContentDevMenu: z.boolean().optional(),
    newLibrary: z.boolean().optional(),
  })
  .strict()
type Experiments = z.infer<typeof experimentsZ>
let experimentsState: Experiments = appStore.get(EXPERIMENTS_STORAGE_KEY) || {}

export const experimentsApi = t.router({
  get: t.procedure.query(async () => {
    return experimentsState
  }),
  write: t.procedure.input(experimentsZ).mutation(async ({input}) => {
    const prevExperimentsState = await appStore.get(EXPERIMENTS_STORAGE_KEY)
    const newExperimentsState = {...(prevExperimentsState || {}), ...input}
    experimentsState = newExperimentsState
    appStore.set(EXPERIMENTS_STORAGE_KEY, newExperimentsState)
    return undefined
  }),
})
