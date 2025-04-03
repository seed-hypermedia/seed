import {toPlainMessage} from '@bufbuild/protobuf'
import {getDocumentTitle} from '@shm/shared/content'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {getRecentsRouteEntityUrl, NavRoute} from '@shm/shared/routes'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {z} from 'zod'
import {grpcClient} from './app-grpc'
// @ts-expect-error ignore this import error
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import * as logger from './logger'

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
  try {
    const url = getRecentsRouteEntityUrl(route)
    if (!url) {
      logger.debug('updateRecentRoute: No URL for route, skipping', {route})
      return
    }

    const type: RecentEntry['type'] = route.key === 'draft' ? 'draft' : 'entity'
    const time = Date.now()
    let title = '?'

    if (route.key === 'document') {
      try {
        logger.debug('updateRecentRoute: Fetching document', {
          account: route.id.uid,
          path: hmIdPathToEntityQueryPath(route.id.path),
        })

        const document = await grpcClient.documents.getDocument({
          account: route.id.uid,
          path: hmIdPathToEntityQueryPath(route.id.path),
          version: route.id.version || undefined,
        })
        title = getDocumentTitle(toPlainMessage(document))
      } catch (error) {
        // Handle document not found or other errors gracefully
        logger.warn('updateRecentRoute: Failed to fetch document', {
          error: error instanceof Error ? error.message : String(error),
          route,
        })
        // Continue with default title
      }
    }

    updateRecents((state: RecentsState): RecentsState => {
      let recents = state.recents.slice(0, MAX_RECENTS - 1) // Ensure we don't exceed MAX_RECENTS
      return {
        recents: [
          ...recents.filter((recent) => recent.url !== url),
          {type, url, title, time},
        ],
      }
    })

    logger.debug('updateRecentRoute: Successfully updated recents', {
      url,
      title,
    })
  } catch (error) {
    // Log error but don't throw - this is a non-critical operation
    logger.error('updateRecentRoute: Failed to update recents', {
      error: error instanceof Error ? error.message : String(error),
      route,
    })
  }
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
