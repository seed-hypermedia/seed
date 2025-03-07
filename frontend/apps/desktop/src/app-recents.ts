import {toPlainMessage} from '@bufbuild/protobuf'
import {getDocumentTitle} from '@shm/shared/content'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {getRecentsRouteEntityUrl, NavRoute} from '@shm/shared/routes'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {z} from 'zod'
import {grpcClient} from './app-grpc'
import {appStore} from './app-store.mts'
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
  let title = '?'
  if (route.key === 'document') {
    const document = await grpcClient.documents.getDocument({
      account: route.id.uid,
      path: hmIdPathToEntityQueryPath(route.id.path),
      version: route.id.version || undefined,
    })
    title = getDocumentTitle(toPlainMessage(document))
  }
  if (!url) return
  updateRecents((state: RecentsState): RecentsState => {
    let recents = state.recents
    return {
      recents: [
        ...recents.filter((recent) => recent.url !== url),
        {type, url, title, time},
      ],
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
