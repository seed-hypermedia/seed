import {NavRoute, getRecentsRouteEntityUrl} from '@/utils/routes'
import {z} from 'zod'
import {invalidateQueries} from './app-invalidation'
import {appStore} from './app-store'
import {t} from './app-trpc'

const RECENTS_STORAGE_KEY = 'Recents-v001'

type RecentEntry = {
  type: 'entity' | 'draft'
  url: string
  title: string
  subtitle?: string
  time: number
}

type RecentsState = {
  recents: RecentEntry[]
}

let recentsState: RecentsState = (appStore.get(
  RECENTS_STORAGE_KEY,
) as RecentsState) || {
  recents: [],
}

const MAX_RECENTS = 20

export function updateRecents(updater: (state: RecentsState) => RecentsState) {
  const newState = updater(recentsState)
  const prevRecents = recentsState.recents
  recentsState = newState
  appStore.set(RECENTS_STORAGE_KEY, recentsState)
  if (prevRecents !== recentsState.recents) {
    invalidateQueries(['trpc.recents.getRecents'])
  }
}

export async function updateRecentRoute(route: NavRoute) {
  const url = getRecentsRouteEntityUrl(route)
  const type: RecentEntry['type'] = route.key === 'draft' ? 'draft' : 'entity'
  const time = Date.now()
  updateRecents((state: RecentsState): RecentsState => {
    let recents = state.recents
    console.log('warning: recents updating not implemented')
    return {
      recents,
    }
  })
}

export const recentsApi = t.router({
  getRecents: t.procedure.query(async () => {
    return recentsState.recents
  }),
  deleteRecent: t.procedure.input(z.string()).mutation(({input}) => {
    updateRecents((state: RecentsState): RecentsState => {
      const recents = state.recents.filter((item) => item.url !== input)
      return {
        ...state,
        recents,
      }
    })
  }),
})
