import {getDocumentTitle} from '@shm/shared/content'
import {queryKeys} from '@shm/shared/models/query-keys'
import {RecentsResult} from '@shm/shared/models/recents'
import {createResourceResolver} from '@shm/shared/resource-loader'
import {getRecentsRouteEntityUrl, NavRoute} from '@shm/shared/routes'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {z} from 'zod'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'

const resolveResource = createResourceResolver(grpcClient)

const RECENTS_STORAGE_KEY = 'Recents-v002'

type RecentEntry = {
  id: string
  name: string
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
  recentsState = newState
  appStore.set(RECENTS_STORAGE_KEY, recentsState)
  appInvalidateQueries([queryKeys.RECENTS])
}

export async function updateRecentRoute(route: NavRoute) {
  const url = getRecentsRouteEntityUrl(route)
  const time = Date.now()
  let name = '?'
  if (route.key === 'document') {
    try {
      const resource = await resolveResource(route.id)
      if (resource.type === 'document') {
        name = getDocumentTitle(resource.document) ?? '?'
      }
    } catch {
      // Document not found or other error - use default name
    }
  }
  if (!url) return
  updateRecents((state: RecentsState): RecentsState => {
    let recents = state.recents
      .filter((recent) => recent.id !== url)
      .slice(0, MAX_RECENTS - 1)
    return {
      recents: [{id: url, name, time}, ...recents],
    }
  })
}

export const recentsApi = t.router({
  getRecents: t.procedure.query(async () => {
    return recentsState.recents.map((recent) => {
      const unpackedId = unpackHmId(recent.id)
      if (!unpackedId) {
        throw new Error(`Invalid hypermedia ID: ${recent.id}`)
      }
      return {
        id: unpackedId,
        name: recent.name,
        time: recent.time,
      } satisfies RecentsResult
    })
  }),
  deleteRecent: t.procedure.input(z.string()).mutation(({input}) => {
    updateRecents((state: RecentsState): RecentsState => {
      const recents = state.recents.filter((item) => item.id !== input)
      return {
        ...state,
        recents,
      }
    })
  }),
  clearAllRecents: t.procedure.mutation(() => {
    updateRecents((): RecentsState => {
      return {
        recents: [],
      }
    })
  }),
})
