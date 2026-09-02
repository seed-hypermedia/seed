import {queryKeys} from '@shm/shared/models/query-keys'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {
  clearServiceLogs,
  createService,
  getService,
  getServiceLogPath,
  getServiceLogs,
  listServices,
  removeService,
  restartService,
  startService,
  stopService,
  subscribeServices,
  updateService,
} from './app-services'
import {t} from './app-trpc'

/** tRPC surface of the service manager, used by the renderer's Services page. */

const serviceInputSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  autoStart: z.boolean().optional(),
})

const serviceIdSchema = z.object({id: z.string().min(1)})

export const servicesApi = t.router({
  list: t.procedure.query(() => listServices()),
  get: t.procedure.input(serviceIdSchema).query(({input}) => getService(input.id)),
  create: t.procedure.input(serviceInputSchema).mutation(({input}) => createService(input)),
  update: t.procedure
    .input(serviceIdSchema.merge(serviceInputSchema.partial()))
    .mutation(({input: {id, ...changes}}) => updateService(id, changes)),
  remove: t.procedure.input(serviceIdSchema).mutation(({input}) => removeService(input.id)),
  start: t.procedure.input(serviceIdSchema).mutation(({input}) => startService(input.id)),
  stop: t.procedure.input(serviceIdSchema).mutation(({input}) => stopService(input.id)),
  restart: t.procedure.input(serviceIdSchema).mutation(({input}) => restartService(input.id)),
  logs: t.procedure
    .input(serviceIdSchema.extend({limit: z.number().int().positive().max(5000).optional()}))
    .query(({input}) => ({lines: getServiceLogs(input.id, input.limit), path: getServiceLogPath(input.id)})),
  clearLogs: t.procedure.input(serviceIdSchema).mutation(({input}) => clearServiceLogs(input.id)),
})

/** Log output can arrive thousands of lines a second; renderer refreshes are coalesced to this rate. */
const LOG_INVALIDATION_INTERVAL_MS = 300

/**
 * Forwards service events to renderer query invalidation so every window's Services page and tray
 * state stay live without polling. Idempotent.
 */
let bridgeStarted = false
export function startServicesInvalidationBridge(): void {
  if (bridgeStarted) return
  bridgeStarted = true
  const pendingLogIds = new Set<string>()
  let logTimer: ReturnType<typeof setTimeout> | null = null
  subscribeServices((event) => {
    if (event.type === 'services') {
      appInvalidateQueries([queryKeys.SERVICES])
      return
    }
    pendingLogIds.add(event.serviceId)
    if (logTimer) return
    logTimer = setTimeout(() => {
      logTimer = null
      for (const id of Array.from(pendingLogIds)) {
        appInvalidateQueries([queryKeys.SERVICE_LOGS, id])
      }
      pendingLogIds.clear()
    }, LOG_INVALIDATION_INTERVAL_MS)
    logTimer.unref?.()
  })
}
