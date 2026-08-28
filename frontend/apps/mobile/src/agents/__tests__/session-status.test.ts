/**
 * Status mapping and plan ownership for the session surfaces.
 *
 * `resolvePinnedPlan` is here because getting it wrong is invisible in a single-turn conversation
 * and actively misleading in a real one: a finished turn's completed checklist gets lent to the
 * next turn's card, which then shows three ticked steps for work the agent has not started. It was
 * exactly that bug, caught against the mock server in `dev/mock-agents-server.ts`.
 */

import type {RunInfo, RunPlan} from '@shm/ui/agents/client'
import {isRunLive, resolvePinnedPlan, runStatusLabel, runStatusTone, sessionStatusTone} from '../session-status'

function makeRun(overrides: Partial<RunInfo> & Pick<RunInfo, 'id' | 'status'>): RunInfo {
  return {
    account: 'account-1',
    rootRunId: overrides.id,
    depth: 0,
    kind: 'agent',
    origin: 'user',
    title: 'A turn',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

const SETTLED_PLAN: RunPlan = {
  steps: [{id: 's1', label: 'Read the source material', status: 'done'}],
  ownerRunId: 'run-1',
  settledAt: 100,
}

describe('run status', () => {
  it('reads a parked run as waiting, never as active', () => {
    // The distinction the whole card rests on: a waiting run holds no resources and may be waiting
    // on the user. Colouring it "active" would say the agent is working when it is not.
    expect(runStatusTone('waiting')).toBe('waiting')
    expect(runStatusLabel('waiting')).toBe('Waiting')
    expect(runStatusTone('running')).toBe('active')
  })

  it('counts queued, claimed, running and waiting as live', () => {
    for (const status of ['queued', 'claimed', 'running', 'waiting'] as const) {
      expect(isRunLive(status)).toBe(true)
    }
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      expect(isRunLive(status)).toBe(false)
    }
  })

  it('maps session statuses to their dots', () => {
    expect(sessionStatusTone('streaming')).toBe('active')
    expect(sessionStatusTone('error')).toBe('error')
    expect(sessionStatusTone('idle')).toBe('idle')
  })
})

describe('resolvePinnedPlan', () => {
  it('prefers the run’s own plan', () => {
    const ownPlan: RunPlan = {steps: [{id: 'a', label: 'Its own step', status: 'running'}]}
    const run = makeRun({id: 'run-2', status: 'running', plan: ownPlan})
    expect(resolvePinnedPlan(run, SETTLED_PLAN)).toBe(ownPlan)
  })

  it('gives the session plan to the run the server stamped as its owner', () => {
    const run = makeRun({id: 'run-1', status: 'running'})
    expect(resolvePinnedPlan(run, SETTLED_PLAN)).toBe(SETTLED_PLAN)
  })

  it('withholds a stamped session plan from a different run', () => {
    // The regression. Turn 2 must not display turn 1's completed checklist.
    const laterRun = makeRun({id: 'run-2', status: 'waiting'})
    expect(resolvePinnedPlan(laterRun, SETTLED_PLAN)).toBeUndefined()
  })

  it('lets a live unplanned run borrow an unstamped legacy plan', () => {
    const legacyPlan: RunPlan = {steps: [{id: 'a', label: 'Legacy step', status: 'running'}]}
    const run = makeRun({id: 'run-9', status: 'running'})
    expect(resolvePinnedPlan(run, legacyPlan)).toBe(legacyPlan)
  })

  it('does not lend an unstamped legacy plan to a finished run', () => {
    // Ownership would only be a guess, and a guess here puts a checklist under the wrong turn.
    const legacyPlan: RunPlan = {steps: [{id: 'a', label: 'Legacy step', status: 'done'}]}
    const run = makeRun({id: 'run-9', status: 'succeeded'})
    expect(resolvePinnedPlan(run, legacyPlan)).toBeUndefined()
  })

  it('returns nothing when there is no run or no plan', () => {
    expect(resolvePinnedPlan(undefined, SETTLED_PLAN)).toBeUndefined()
    expect(resolvePinnedPlan(makeRun({id: 'run-1', status: 'running'}), undefined)).toBeUndefined()
  })
})
