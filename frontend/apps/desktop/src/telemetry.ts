import {grpcClient} from '@/grpc-client'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {GRPCClient} from '@shm/shared/grpc-client'
import {NavRoute} from '@shm/shared/routes'
import {hmIdToURL} from '@shm/shared/utils/entity-id-url'

export const TELEMETRY_DEBOUNCE_MS = 400

export const TelemetryStage = {
  LinkClick: 'renderer.link_click',
  ComponentRendered: 'renderer.component_rendered',
} as const

type TelemetryStageValue = (typeof TelemetryStage)[keyof typeof TelemetryStage]

type TelemetryCheckpoint = {
  key: string
  stage: TelemetryStageValue | string
  tsUnixNanos: bigint
}

type TelemetryClient = Pick<GRPCClient, 'telemetry'>

type TelemetryReporterOptions = {
  client: TelemetryClient
  source?: string
  debounceMs?: number
  nowNanos?: () => bigint
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
  onError?: (error: unknown) => void
}

export function performanceNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return 0
}

export function unixNanosFromPerformanceNow(): bigint {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    const origin = typeof performance.timeOrigin === 'number' ? performance.timeOrigin : Date.now() - performance.now()
    const unixMs = origin + performanceNow()
    const millis = Math.trunc(unixMs)
    const nanos = Math.round((unixMs - millis) * 1_000_000)
    return BigInt(millis) * BigInt(1_000_000) + BigInt(nanos)
  }
  return BigInt(Date.now()) * BigInt(1_000_000)
}

export function telemetryKeyForId(id: UnpackedHypermediaId | null | undefined): string | null {
  if (!id?.uid) return null
  return hmIdToURL({
    uid: id.uid,
    id: id.id,
    path: id.path ?? null,
    version: id.version ?? null,
    latest: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  })
}

export function telemetryKeyForRoute(route: NavRoute): string | null {
  const id = (route as {id?: unknown}).id
  if (!id || typeof id !== 'object' || !('uid' in id)) return null
  return telemetryKeyForId(id as UnpackedHypermediaId)
}

export function createTelemetryReporter({
  client,
  source = defaultTelemetrySource(),
  debounceMs = TELEMETRY_DEBOUNCE_MS,
  nowNanos = unixNanosFromPerformanceNow,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onError = defaultTelemetryErrorHandler,
}: TelemetryReporterOptions) {
  let pending: TelemetryCheckpoint[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushInFlight: Promise<void> | null = null

  async function flushNow() {
    if (timer) {
      clearTimer(timer)
      timer = null
    }
    if (!pending.length) return flushInFlight ?? Promise.resolve()

    const checkpoints = pending
    pending = []

    const flushPromise = client.telemetry
      .recordCheckpoints({source, checkpoints})
      .catch((error: unknown) => {
        onError(error)
      })
      .then(() => undefined)

    const trackedFlush = flushPromise.finally(() => {
      if (flushInFlight === trackedFlush) {
        flushInFlight = null
      }
    })
    flushInFlight = trackedFlush

    return trackedFlush
  }

  function scheduleFlush() {
    if (timer) return
    timer = setTimer(() => {
      timer = null
      void flushNow()
    }, debounceMs)
  }

  function report(key: string | null | undefined, stage: TelemetryStageValue | string) {
    if (!key || !stage) return
    pending.push({key, stage, tsUnixNanos: nowNanos()})
    scheduleFlush()
  }

  return {
    report,
    flush: flushNow,
    pendingCount: () => pending.length,
  }
}

function defaultTelemetrySource() {
  const windowId = typeof window === 'undefined' ? undefined : window.windowId
  return windowId ? `renderer:${windowId}` : 'renderer'
}

function defaultTelemetryErrorHandler(error: unknown) {
  console.warn('[telemetry] failed to record checkpoints', error)
}

export const telemetryReporter = createTelemetryReporter({client: grpcClient})

export function reportTelemetry(key: string | null | undefined, stage: TelemetryStageValue | string) {
  telemetryReporter.report(key, stage)
}

export function flushTelemetry() {
  return telemetryReporter.flush()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    void flushTelemetry()
  })
}
