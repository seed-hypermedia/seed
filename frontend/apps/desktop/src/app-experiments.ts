import {AppExperiments, appExperimentsSchema} from '@shm/shared'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const EXPERIMENTS_STORAGE_KEY = 'Experiments-v001'

let experimentsState: AppExperiments =
  appStore.get(EXPERIMENTS_STORAGE_KEY) || {}

export const experimentsApi = t.router({
  get: t.procedure.query(async () => {
    return experimentsState
  }),
  write: t.procedure.input(appExperimentsSchema).mutation(async ({input}) => {
    const prevExperimentsState = await appStore.get(EXPERIMENTS_STORAGE_KEY)
    const newExperimentsState = {...(prevExperimentsState || {}), ...input}
    experimentsState = newExperimentsState
    appStore.set(EXPERIMENTS_STORAGE_KEY, newExperimentsState)
    return undefined
  }),
})
