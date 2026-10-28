import {HMHostConfig, HMHostConfigSchema} from '@seed-hypermedia/client/hm-types'
import {net, powerMonitor} from 'electron'
import z from 'zod/v3'
import {grpcClient} from './app-grpc'
import {appStore} from './app-store.mts'
import {t} from './app-trpc'
import * as log from './logger'

const PENDING_PUSHES_KEY = 'PendingPushes'

/**
 * A push the desktop still owes a host. `resourceUrl` is announced to the
 * host's daemon with `PushResourcesToPeer`, which carries the resource and
 * everything anchored to it (comments included) that the host lacks.
 */
export type PendingPush = {
  resourceUrl: string
  host: string
  createdAt: number
  attempts: number
  nextAttempt: number
  lastError?: string
}

/** Delay before retry number n (1-based); the last step repeats. */
export const PUSH_RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]

/** A push that has not landed within this long is given up on. */
export const PUSH_EXPIRY_MS = 7 * 24 * 60 * 60_000

const WORKER_INTERVAL_MS = 60_000
const HOST_CONFIG_TIMEOUT_MS = 10_000

function readPending(): PendingPush[] {
  const stored = appStore.get(PENDING_PUSHES_KEY)
  return Array.isArray(stored) ? (stored as PendingPush[]) : []
}

function writePending(entries: PendingPush[]) {
  appStore.set(PENDING_PUSHES_KEY, entries)
}

function samePush(entry: PendingPush, resourceUrl: string, host: string) {
  return entry.resourceUrl === resourceUrl && entry.host === host
}

/** Records that `resourceUrl` must reach `host`. An entry already waiting keeps its schedule. */
export function enqueuePush(resourceUrl: string, host: string, now = Date.now()) {
  const entries = readPending()
  if (entries.some((entry) => samePush(entry, resourceUrl, host))) return
  writePending([...entries, {resourceUrl, host, createdAt: now, attempts: 0, nextAttempt: now}])
}

/** Forgets a push once `host` acknowledged it. */
export function removePush(resourceUrl: string, host: string) {
  const entries = readPending()
  const kept = entries.filter((entry) => !samePush(entry, resourceUrl, host))
  if (kept.length !== entries.length) writePending(kept)
}

/** Every push still waiting for a host. */
export function listPendingPushes(): PendingPush[] {
  return readPending()
}

/** Delay before the next try after `attempts` failures. */
export function pushRetryDelay(attempts: number): number {
  return PUSH_RETRY_BACKOFF_MS[Math.min(Math.max(attempts, 1), PUSH_RETRY_BACKOFF_MS.length) - 1]!
}

/** Fetches `/hm/api/config` of a Seed host: its daemon's peer id and addresses. */
export async function fetchHostConfig(host: string, timeout = HOST_CONFIG_TIMEOUT_MS): Promise<HMHostConfig> {
  const res = await fetch(`${host}/hm/api/config`, {signal: AbortSignal.timeout(timeout)})
  if (res.status !== 200) {
    let message = `Space returned status ${res.status}`
    try {
      const error = await res.json()
      if (error.message) message = error.message
    } catch {
      // Response wasn't JSON (e.g. plain text error from server)
    }
    throw new Error(message)
  }
  let config
  try {
    config = await res.json()
  } catch {
    throw new Error(`Space returned invalid response`)
  }
  return HMHostConfigSchema.parse(config)
}

/** What one retry pass needs from the outside world; tests inject fakes. */
export type PushQueueDeps = {
  isOnline: () => boolean
  fetchHostConfig: (host: string) => Promise<{addrs: string[]}>
  pushToPeer: (addrs: string[], resourceUrl: string) => Promise<void>
  now: () => number
}

const liveDeps: PushQueueDeps = {
  isOnline: () => net.isOnline(),
  fetchHostConfig: (host) => fetchHostConfig(host),
  pushToPeer: async (addrs, resourceUrl) => {
    const progress = grpcClient.resources.pushResourcesToPeer({addrs, recursive: true, resources: [resourceUrl]})
    // The stream ends once the peer has fetched everything it wanted.
    for await (const step of progress) {
      log.debug('Pending push progress', {
        resourceUrl,
        blobsProcessed: step.blobsProcessed,
        blobsWanted: step.blobsWanted,
      })
    }
  },
  now: () => Date.now(),
}

/**
 * One pass over the queue: drops expired entries and, while online, retries
 * every due one, serially so a slow host does not fan out. A pass that runs
 * offline leaves attempts and schedules untouched, so time spent offline never
 * burns the backoff.
 */
export async function runPushQueuePass(deps: PushQueueDeps): Promise<void> {
  const now = deps.now()
  const entries = readPending()
  const live = entries.filter((entry) => now - entry.createdAt < PUSH_EXPIRY_MS)
  if (live.length !== entries.length) {
    for (const entry of entries) {
      if (live.includes(entry)) continue
      log.warn('Giving up on pending push', {
        resourceUrl: entry.resourceUrl,
        host: entry.host,
        attempts: entry.attempts,
        lastError: entry.lastError,
      })
    }
    writePending(live)
  }
  if (!live.length || !deps.isOnline()) return
  for (const entry of live.filter((candidate) => candidate.nextAttempt <= now)) {
    try {
      const config = await deps.fetchHostConfig(entry.host)
      await deps.pushToPeer(config.addrs, entry.resourceUrl)
      removePush(entry.resourceUrl, entry.host)
      log.info('Pending push delivered', {
        resourceUrl: entry.resourceUrl,
        host: entry.host,
        attempts: entry.attempts + 1,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const attempts = entry.attempts + 1
      // Re-read: the live push in the renderer may have removed the entry meanwhile.
      writePending(
        readPending().map((candidate) =>
          samePush(candidate, entry.resourceUrl, entry.host)
            ? {...candidate, attempts, lastError: message, nextAttempt: deps.now() + pushRetryDelay(attempts)}
            : candidate,
        ),
      )
      log.warn('Pending push failed, will retry', {
        resourceUrl: entry.resourceUrl,
        host: entry.host,
        attempts,
        error: message,
      })
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let passRunning = false
let started = false

function scheduleNextPass(delayMs: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runScheduledPass()
  }, delayMs)
}

async function runScheduledPass() {
  if (passRunning) {
    scheduleNextPass(WORKER_INTERVAL_MS)
    return
  }
  passRunning = true
  try {
    await runPushQueuePass(liveDeps)
  } catch (error) {
    log.error('Pending push pass failed', {error: error instanceof Error ? error.message : String(error)})
  } finally {
    passRunning = false
    scheduleNextPass(WORKER_INTERVAL_MS)
  }
}

/** Runs a pass soon; the renderer calls it when the network comes back. */
export function kickPushQueue() {
  if (!started) return
  scheduleNextPass(0)
}

/** Starts the retry loop; call once the daemon is ready. Also wakes it when the machine resumes from sleep. */
export function startPushQueueWorker() {
  if (started) return
  started = true
  powerMonitor.on('resume', () => kickPushQueue())
  scheduleNextPass(0)
}

/** Renderer access to the queue: record a push before attempting it, clear it on success, or wake the worker. */
export const pushQueueApi = t.router({
  enqueue: t.procedure.input(z.object({resourceUrl: z.string(), host: z.string()})).mutation(async ({input}) => {
    enqueuePush(input.resourceUrl, input.host)
  }),
  remove: t.procedure.input(z.object({resourceUrl: z.string(), host: z.string()})).mutation(async ({input}) => {
    removePush(input.resourceUrl, input.host)
  }),
  list: t.procedure.query(async () => listPendingPushes()),
  kick: t.procedure.mutation(async () => {
    kickPushQueue()
  }),
})
