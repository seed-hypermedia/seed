import z from 'zod'
import {appStore} from './app-store'
import {t} from './app-trpc'

const RECENT_SIGNERS_STORAGE_KEY = 'RecentSigners-v001'

type RecentSignersState = {
  recentSigners: string[]
}

let state: RecentSignersState = (appStore.get(
  RECENT_SIGNERS_STORAGE_KEY,
) as RecentSignersState) || {recentSigners: []}

async function writeRecentSigner(accountUid: string) {
  state = {
    ...state,
    recentSigners: [
      accountUid,
      ...state.recentSigners.filter((signer) => signer !== accountUid),
    ],
  }
  appStore.set(RECENT_SIGNERS_STORAGE_KEY, state)
  return undefined
}

export const recentSignersApi = t.router({
  get: t.procedure.query(async () => {
    return state
  }),
  writeRecentSigner: t.procedure.input(z.string()).mutation(async ({input}) => {
    await writeRecentSigner(input)
    return undefined
  }),
})
