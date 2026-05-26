import {HMQueryBlockInput, HMQueryBlockPayload} from '@seed-hypermedia/client/hm-types'
import {ProfilerOnRenderCallback, useEffect, useMemo, useRef} from 'react'

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number | null | undefined) {
  if (value == null) return null
  return Math.round(value * 10) / 10
}

function diffMs(from: number | undefined, to: number | undefined) {
  if (from == null || to == null) return null
  return to - from
}

type PerfState = {
  mountedAt: number
  queryReadyAt?: number
  fetchStartAt?: number
  dataReadyAt?: number
  logged: boolean
}

function createPerfState(): PerfState {
  return {
    mountedAt: now(),
    logged: false,
  }
}

/** Tracks query-block frontend timing and logs a single summary after first committed content. */
export function useQueryBlockFrontendPerf({
  source,
  blockId,
  queryInput,
  style,
  banner,
  active,
  status,
  fetchStatus,
  data,
  error,
}: {
  source: 'editor' | 'desktop'
  blockId: string
  queryInput: HMQueryBlockInput | null
  style: 'Card' | 'List'
  banner: boolean
  active: boolean
  status: 'pending' | 'loading' | 'error' | 'success'
  fetchStatus: 'idle' | 'fetching' | 'paused'
  data: HMQueryBlockPayload | null | undefined
  error?: unknown
}) {
  const perfKey = useMemo(
    () => JSON.stringify({query: queryInput?.query ?? null, style, banner}),
    [banner, queryInput?.query, style],
  )
  const perfStateRef = useRef<PerfState>(createPerfState())
  const latestRef = useRef({
    source,
    blockId,
    queryInput,
    style,
    banner,
    active,
    status,
    fetchStatus,
    data,
    error,
  })

  latestRef.current = {
    source,
    blockId,
    queryInput,
    style,
    banner,
    active,
    status,
    fetchStatus,
    data,
    error,
  }

  useEffect(() => {
    perfStateRef.current = createPerfState()
  }, [perfKey])

  const perfState = perfStateRef.current
  if (queryInput && !perfState.queryReadyAt) {
    perfState.queryReadyAt = now()
  }
  if (fetchStatus === 'fetching' && !perfState.fetchStartAt) {
    perfState.fetchStartAt = now()
  }
  if (status === 'success' && !perfState.dataReadyAt) {
    perfState.dataReadyAt = now()
  }

  useEffect(() => {
    const params = latestRef.current
    const state = perfStateRef.current
    if (params.status !== 'error' || state.logged || !params.queryInput) return

    state.logged = true
    console.info(
      '[QueryBlock frontend perf]',
      JSON.stringify({
        status: 'error',
        source: params.source,
        blockId: params.blockId,
        query: {
          includes: params.queryInput.query.includes.map(({space, path, mode}) => ({space, path, mode})),
          limit: params.queryInput.query.limit ?? null,
          sortCount: params.queryInput.query.sort?.length ?? 0,
        },
        style: params.style,
        banner: params.banner,
        activeAtLog: params.active,
        frontendDurationsMs: {
          sinceMount: roundMs(diffMs(state.mountedAt, now())),
          sinceQueryReady: roundMs(diffMs(state.queryReadyAt, now())),
          untilFetchStart: roundMs(diffMs(state.queryReadyAt, state.fetchStartAt)),
        },
        error: params.error instanceof Error ? params.error.message : String(params.error),
      }),
    )
  }, [error, status])

  const onRender: ProfilerOnRenderCallback = (_id, _phase, actualDuration, baseDuration, _startTime, commitTime) => {
    const params = latestRef.current
    const state = perfStateRef.current
    if (state.logged || !params.queryInput || params.status !== 'success') return

    state.logged = true

    console.info(
      '[QueryBlock frontend perf]',
      JSON.stringify({
        status: 'success',
        source: params.source,
        blockId: params.blockId,
        query: {
          includes: params.queryInput.query.includes.map(({space, path, mode}) => ({space, path, mode})),
          limit: params.queryInput.query.limit ?? null,
          sortCount: params.queryInput.query.sort?.length ?? 0,
        },
        style: params.style,
        banner: params.banner,
        activeAtCommit: params.active,
        resultItemCount: params.data?.results.length ?? 0,
        accountsMetadataCount: Object.keys(params.data?.accountsMetadata ?? {}).length,
        frontendDurationsMs: {
          sinceMount: roundMs(diffMs(state.mountedAt, commitTime)),
          sinceQueryReady: roundMs(diffMs(state.queryReadyAt, commitTime)),
          untilFetchStart: roundMs(diffMs(state.queryReadyAt, state.fetchStartAt)),
          queryFetch: roundMs(diffMs(state.fetchStartAt, state.dataReadyAt)),
          dataToCommit: roundMs(diffMs(state.dataReadyAt, commitTime)),
        },
        reactCommitMs: {
          actualDuration: roundMs(actualDuration),
          baseDuration: roundMs(baseDuration),
        },
        queryState: {
          fetchStatus: params.fetchStatus,
          cacheHit: !state.fetchStartAt,
        },
      }),
    )
  }

  return {onRender}
}
