import {useActorRef, useSelector} from '@xstate/react'
import {useEffect, useMemo} from 'react'
import {
  createShapeHomeHelperMachine,
  shapeHomeJobEventFromSnapshot,
  type HelperEffects,
  type ShapeHomeSiteRecord,
} from '@shm/shared/models/shape-home-machines'
import {ShapeHomeHelper} from './shape-home-helper'

/** Snapshot job shape provided by the platform adapter. */
export interface ShapeHomeHelperSnapshotJob {
  id: string
  state: string
  addedTargetIds?: string[]
  skippedTargetIds?: string[]
  lastError?: string
}

/** Props for the platform-neutral Shape Home helper container. */
export interface ShapeHomeHelperContainerProps {
  uid: string
  record?: ShapeHomeSiteRecord
  /** Helper machine effects (loadCandidates returns ShapeHomeCandidate[]). */
  effects: HelperEffects
  /** Current cleanup jobs (polled by the adapter). */
  jobs: ShapeHomeHelperSnapshotJob[]
}

/**
 * Platform-neutral Shape Home helper: owns the memoized helper machine, drives
 * job events from the snapshot, sends `resumed` on window focus while choosing,
 * and maps machine state to the presentational `ShapeHomeHelper`.
 */
export function ShapeHomeHelperContainer({uid, record, effects, jobs}: ShapeHomeHelperContainerProps) {
  const machine = useMemo(
    () =>
      createShapeHomeHelperMachine({
        loadCandidates: effects.loadCandidates,
        enqueueAddCards: effects.enqueueAddCards,
        retryJob: effects.retryJob,
        persistRecord: effects.persistRecord,
        refreshHome: effects.refreshHome,
        toastResult: effects.toastResult,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid],
  )

  const actor = useActorRef(machine, {input: {uid, record}})

  const jobId = useSelector(actor, (s) => s.context.jobId)
  const state = useSelector(actor, (s) => s.value as string)
  const candidates = useSelector(actor, (s) => s.context.candidates)
  const selectedIds = useSelector(actor, (s) => s.context.selectedIds)
  const showAll = useSelector(actor, (s) => s.context.showAll)
  const error = useSelector(actor, (s) => s.context.error)

  // Drive job events from the snapshot, including on mount for an `adding` record.
  useEffect(() => {
    if (!jobs || jobs.length === 0) return
    const targetId = jobId ?? (record?.status === 'adding' ? record.jobId : undefined)
    if (!targetId) return
    const job = jobs.find((j) => j.id === targetId)
    if (!job) return
    const evt = shapeHomeJobEventFromSnapshot(job as any)
    if (evt) actor.send(evt as any)
  }, [jobId, jobs, actor, record])

  // Send resumed on window focus while choosing.
  useEffect(() => {
    const onFocus = () => {
      const snap = actor.getSnapshot()
      if (snap.matches('choosing')) actor.send({type: 'resumed'})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [actor])

  if (state === 'hidden' || state === 'dismissed' || state === 'finished') return null

  const helperState =
    state === 'loading'
      ? 'loading'
      : state === 'enqueuing' || state === 'waitingForJob' || state === 'retrying'
        ? 'adding'
        : state === 'addFailed'
          ? 'failed'
          : state === 'loadFailed'
            ? 'loadFailed'
            : 'choosing'

  return (
    <ShapeHomeHelper
      state={helperState}
      candidates={candidates.map((c) => ({id: c.id.id, title: c.title}))}
      selected={selectedIds}
      showAll={showAll}
      error={error}
      onToggle={(id) => actor.send({type: 'toggle', id})}
      onShowMore={() => actor.send({type: 'showMore'})}
      onAdd={() => actor.send({type: 'add'})}
      onRetry={() => actor.send({type: 'retry'})}
      onNotNow={() => actor.send({type: 'notNow'})}
    />
  )
}
