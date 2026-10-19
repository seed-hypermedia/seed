import {NOTIFY_API_PREFIX} from '@shm/shared/notify-url'
import * as emailNotifToken from './routes/email-notif-token'
import * as notificationConfig from './routes/notification-config'
import * as notificationInbox from './routes/notification-inbox'
import * as notificationReadState from './routes/notification-read-state'
import * as notifications from './routes/notifications'
import * as publicSubscribe from './routes/public-subscribe'
import * as readRedirect from './routes/read-redirect'
import * as unsubscribe from './routes/unsubscribe'
import * as verifyEmail from './routes/verify-email'
import type {Handler} from './server-api'
import {corsJson, preflightCorsResponse} from './utils/cors'

type MethodHandlers = {GET?: Handler; POST?: Handler}

/** A Bun.serve route entry: one handler per method. */
export type RouteHandlers = {GET: Handler; POST: Handler; OPTIONS: Handler}

const methodNotAllowed: Handler = () => corsJson({error: 'Method not allowed'}, {status: 405})

function route(handlers: MethodHandlers): RouteHandlers {
  return {
    GET: handlers.GET ?? methodNotAllowed,
    POST: handlers.POST ?? methodNotAllowed,
    OPTIONS: preflightCorsResponse,
  }
}

const health = route({
  GET: () =>
    corsJson({
      status: 'ok',
      service: 'notify',
      commit: process.env.COMMIT_HASH || process.env.NOTIFY_SENTRY_RELEASE || null,
    }),
})

/**
 * API leaves served both canonically at `/hm/api/notify/<leaf>` and at the legacy `/hm/api/<leaf>`
 * (older clients hold an origin-only notify URL and append `/hm/api/<leaf>`).
 */
const apiLeaves: Record<string, RouteHandlers> = {
  notifications: route(notifications),
  'notification-config': route(notificationConfig),
  'notification-inbox': route(notificationInbox),
  'notification-read-state': route(notificationReadState),
  'public-subscribe': route(publicSubscribe),
  'public-subscribe/*': route(publicSubscribe),
  'email-notif-token': route(emailNotifToken),
  unsubscribe: route(unsubscribe),
}

/** Leaves that exist only under the canonical prefix: email links and the health check. */
const canonicalOnlyLeaves: Record<string, RouteHandlers> = {
  'read-redirect': route(readRedirect),
  'verify-email': route(verifyEmail),
  health,
}

/** The notify route table, keyed by Bun.serve path pattern. */
export function createRoutes(): Record<string, RouteHandlers> {
  const routes: Record<string, RouteHandlers> = {}
  for (const [leaf, handlers] of Object.entries(apiLeaves)) {
    routes[`${NOTIFY_API_PREFIX}/${leaf}`] = handlers
    routes[`/hm/api/${leaf}`] = handlers
  }
  for (const [leaf, handlers] of Object.entries(canonicalOnlyLeaves)) {
    routes[`${NOTIFY_API_PREFIX}/${leaf}`] = handlers
  }
  return routes
}

/** Fallback for paths outside the route table. */
export function notFound(request: Request): Response {
  if (request.method === 'OPTIONS') return preflightCorsResponse()
  return corsJson({error: 'Not found'}, {status: 404})
}
