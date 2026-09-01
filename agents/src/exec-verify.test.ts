import {describe, expect, test} from 'bun:test'
import {judgeAttempt, judgeScenario, type AttemptEvidence, type CounterWindow} from '@/exec-verify'

const zeros: CounterWindow = {resetExhausted: 0, resetError: 0, probeFailed: 0, poolHit: 0}

const evidence = (
  overrides: Partial<Omit<AttemptEvidence, 'call1' | 'call2'>> & {
    call1?: Partial<CounterWindow>
    call2?: Partial<CounterWindow>
  },
): AttemptEvidence => ({
  planted: true,
  reused: false,
  clean: true,
  ...overrides,
  call1: {...zeros, ...overrides.call1},
  call2: {...zeros, ...overrides.call2},
})

/** A converged expect-disposal attempt: storm cleaned up, VM reused, disposal path unexercised. */
const converged = evidence({reused: true, call2: {poolHit: 1}})

/** A properly attributed disposal: call-1 reset exhausted, call-2 contributed nothing. */
const attributedDisposal = evidence({reused: false, call1: {resetExhausted: 1}})

describe('exec-verify judgements', () => {
  test('REGRESSION (ion, sixth pass): converged-then-attributed-disposal must FAIL the scenario', () => {
    // A converged attempt followed by a lucky disposal previously overwrote the failure with
    // PASS, silently hiding the convergence. The sequence rule forbids that forever.
    const result = judgeScenario('expect-disposal', [converged, attributedDisposal])
    expect(result.failed).toBe(true)
    expect(result.verdict).toContain('converged')
  })

  test('a converged expect-disposal attempt is a terminal failure on its own', () => {
    const result = judgeAttempt('expect-disposal', converged)
    expect(result.failed).toBe(true)
  })

  test('an attributed disposal passes expect-disposal', () => {
    expect(judgeAttempt('expect-disposal', attributedDisposal).failed).toBe(false)
  })

  test('a disposal with a call-2 disposal counter is not attributable and fails', () => {
    const tainted = evidence({reused: false, call1: {resetExhausted: 1}, call2: {probeFailed: 1}})
    expect(judgeAttempt('expect-disposal', tainted).failed).toBe(true)
  })

  test('a disposal marked as reset transport error fails expect-disposal', () => {
    const errored = evidence({reused: false, call1: {resetExhausted: 1, resetError: 1}})
    expect(judgeAttempt('expect-disposal', errored).failed).toBe(true)
  })

  test('a failed plant fails every expectation', () => {
    for (const expectation of ['reuse-clean', 'clean', 'expect-disposal'] as const) {
      expect(judgeAttempt(expectation, evidence({planted: false})).failed).toBe(true)
    }
  })

  test('an unclean call 2 fails every expectation', () => {
    for (const expectation of ['reuse-clean', 'clean', 'expect-disposal'] as const) {
      expect(judgeAttempt(expectation, evidence({clean: false})).failed).toBe(true)
    }
  })

  test('reuse-clean requires the pool hit and zero disposal counters', () => {
    const good = evidence({reused: true, call2: {poolHit: 1}})
    expect(judgeAttempt('reuse-clean', good).failed).toBe(false)
    const disposedInstead = evidence({reused: false})
    expect(judgeAttempt('reuse-clean', disposedInstead).failed).toBe(true)
    const hitWithReset = evidence({reused: true, call1: {resetExhausted: 1}, call2: {poolHit: 1}})
    expect(judgeAttempt('reuse-clean', hitWithReset).failed).toBe(true)
  })

  test('clean accepts either a pool-hit reuse or an attributed disposal, nothing else', () => {
    expect(judgeAttempt('clean', evidence({reused: true, call2: {poolHit: 1}})).failed).toBe(false)
    expect(judgeAttempt('clean', attributedDisposal).failed).toBe(false)
    expect(judgeAttempt('clean', evidence({reused: false})).failed).toBe(true)
  })

  test('an empty attempt sequence fails', () => {
    expect(judgeScenario('clean', []).failed).toBe(true)
  })
})
