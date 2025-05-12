import z from 'zod'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const PROMPTING_STORAGE_KEY = 'Prompting-v001'

type PromptingState = {
  promptedKeys: string[]
}

let state: PromptingState = (appStore.get(
  PROMPTING_STORAGE_KEY,
) as PromptingState) || {promptedKeys: []}

async function writePrompting(newState: PromptingState) {
  state = newState
  appStore.set(PROMPTING_STORAGE_KEY, newState)
  return undefined
}

export const promptingApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),
  getPromptedKey: t.procedure.input(z.string()).query(async ({input}) => {
    return state.promptedKeys.includes(input)
  }),
  markPromptedKey: t.procedure
    .input(z.object({key: z.string(), isPrompted: z.boolean()}))
    .mutation(async ({input}) => {
      const newPromptedKeys = state.promptedKeys.filter(
        (key) => key !== input.key,
      )
      if (input.isPrompted) {
        newPromptedKeys.push(input.key)
      }
      await writePrompting({
        ...state,
        promptedKeys: newPromptedKeys,
      })
    }),
})
