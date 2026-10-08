import {AppExperiments, appExperimentsSchema} from '@shm/shared'
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import {chromiumPolicySchema, getChromiumStatus, setChromiumPolicy} from './app-chromium-age'

const EXPERIMENTS_STORAGE_KEY = 'Experiments-v001'
const CHROMIUM_POLICY_STORAGE_KEY = 'ChromiumPolicy-v001'

const cachedChromiumPolicy = chromiumPolicySchema.safeParse(appStore.get(CHROMIUM_POLICY_STORAGE_KEY))
if (cachedChromiumPolicy.success) setChromiumPolicy(cachedChromiumPolicy.data)

/** Persists the last accepted manifest policy so going offline or restarting cannot bypass its minimum. */
export function updateChromiumPolicy(value: unknown): void {
  appStore.set(CHROMIUM_POLICY_STORAGE_KEY, setChromiumPolicy(value))
}

let experimentsState: AppExperiments = appStore.get(EXPERIMENTS_STORAGE_KEY) || {}

/**
 * Returns the stored embedding enabled setting.
 * Used by main.ts to determine daemon startup flags before tRPC is ready.
 */
export function getStoredEmbeddingEnabled(): boolean {
  const experiments = appStore.get(EXPERIMENTS_STORAGE_KEY) || {}
  return experiments.embeddingEnabled || false
}

export const experimentsApi = t.router({
  getChromiumStatus: t.procedure.query(() => getChromiumStatus()),
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
