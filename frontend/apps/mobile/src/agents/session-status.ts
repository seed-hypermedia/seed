/**
 * Mapping the protocol's session and run lifecycles onto the status colours the UI draws.
 *
 * Kept in one place because the same run status has to read consistently in three spots — the
 * session list dot, the run card's pill, and a child row inside a plan step — and a card that
 * called `waiting` "active" would tell the reader the agent is working when it is in fact parked,
 * possibly on them.
 */

import type {RunInfo, RunPlan, RunStatus, SessionInfo} from '@shm/ui/agents/client'
import type {StatusTone} from './ui/primitives'

/** Colour for a session's derived status. */
export function sessionStatusTone(status: SessionInfo['status']): StatusTone {
  switch (status) {
    case 'streaming':
      return 'active'
    case 'error':
      return 'error'
    case 'stopped':
      return 'idle'
    default:
      return 'idle'
  }
}

/** Colour for a durable run's status. */
export function runStatusTone(status: RunStatus): StatusTone {
  switch (status) {
    case 'running':
    case 'claimed':
    case 'queued':
      return 'active'
    case 'waiting':
      return 'waiting'
    case 'succeeded':
      return 'done'
    case 'failed':
      return 'error'
    case 'canceled':
      return 'idle'
    default:
      return 'idle'
  }
}

/** Whether a run is still going, so the UI keeps its timer ticking and its cancel button live. */
export function isRunLive(status: RunStatus): boolean {
  return status === 'queued' || status === 'claimed' || status === 'running' || status === 'waiting'
}

/** Human label for a run status pill. */
export function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'claimed':
      return 'Starting'
    case 'running':
      return 'Working'
    case 'waiting':
      return 'Waiting'
    case 'succeeded':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'canceled':
      return 'Canceled'
    default:
      return 'Queued'
  }
}

/**
 * The checklist the pinned run card should draw for `run`, if any.
 *
 * A session-level plan outlives the turn that produced it: a model-driven agent keeps its checklist
 * on the session rather than the run, and it stays there after that run ends. So it cannot simply
 * be handed to whichever run is current — doing so lends a finished turn's completed checklist to
 * the next turn's card, which then shows ticked steps for work the agent is not doing.
 *
 * The server stamps `ownerRunId` for exactly this purpose (it is never accepted from model input).
 * Plans predating that field keep the older rule: a still-live run with no plan of its own may
 * borrow it. This mirrors `interleaveRunRecords` in the shared row model, so the pinned card and
 * the frozen card in the transcript cannot disagree about whose plan it is.
 */
export function resolvePinnedPlan(run: RunInfo | undefined, sessionPlan: RunPlan | undefined): RunPlan | undefined {
  if (!run) return undefined
  if (run.plan) return run.plan
  if (!sessionPlan) return undefined
  if (sessionPlan.ownerRunId) return sessionPlan.ownerRunId === run.id ? sessionPlan : undefined
  return isRunLive(run.status) ? sessionPlan : undefined
}
