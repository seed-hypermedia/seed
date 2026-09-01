/**
 * Pure verdict logic for the warm-pool reset verifier (scripts/verify-exec-reset.ts).
 *
 * Extracted so the control flow is unit-testable without a microVM: ion's sixth review pass found
 * the script-embedded verdict for a converged expect-disposal attempt could be OVERWRITTEN by a
 * later successful retry, silently hiding the convergence the harness claims to always report.
 * Here the rule is structural: {@link judgeScenario} returns the FIRST failed attempt's judgement
 * and never lets a later pass overwrite it, and every attempt outcome is terminal — a scenario is
 * decided by its first attempt, with reruns being a human decision, not a silent loop.
 */

/** Pool counter deltas observed across one executor call. */
export type CounterWindow = {resetExhausted: number; resetError: number; probeFailed: number; poolHit: number}

/** Everything one scenario attempt observed. */
export type AttemptEvidence = {
  /** Call 1 exited 0 and verified its daemon alive (PLANTED-OK). */
  planted: boolean
  /** Call 2 ran on the same VM (bootMs 0). */
  reused: boolean
  /** Call 2 exited 0 and found no marked process alive. */
  clean: boolean
  /** Counter deltas around call 1 (the plant and its release reset — the reset under test). */
  call1: CounterWindow
  /** Counter deltas around call 2 (the autopsy's own acquire/release must contribute nothing). */
  call2: CounterWindow
}

export type Expectation = 'reuse-clean' | 'clean' | 'expect-disposal'

export type AttemptJudgement = {verdict: string; failed: boolean}

export const noDisposals = (w: CounterWindow): boolean =>
  w.resetExhausted === 0 && w.resetError === 0 && w.probeFailed === 0

const show = (w: CounterWindow): string => JSON.stringify(w)

/** Judges one attempt against its scenario's expectation. Every outcome is terminal. */
export function judgeAttempt(expect: Expectation, a: AttemptEvidence): AttemptJudgement {
  if (!a.planted) return {verdict: 'FAIL (plant did not take — scenario proves nothing)', failed: true}
  if (!a.clean) return {verdict: 'FAIL (a prior-call process was running in call 2)', failed: true}
  if (expect === 'reuse-clean') {
    if (a.reused && a.call2.poolHit === 1 && noDisposals(a.call1) && noDisposals(a.call2)) {
      return {verdict: 'PASS (call-1 reset succeeded; call-2 pool hit, reused clean VM)', failed: false}
    }
    if (!a.reused) return {verdict: 'FAIL (reset disposed the VM for a trivially cleanable guest)', failed: true}
    return {
      verdict: `FAIL (reuse not attributable to a clean pool hit: call1=${show(a.call1)} call2=${show(a.call2)})`,
      failed: true,
    }
  }
  if (expect === 'clean') {
    if (a.reused && a.call2.poolHit === 1) return {verdict: 'PASS (clean; reused via pool hit)', failed: false}
    if (!a.reused && a.call1.resetExhausted >= 1) {
      return {verdict: 'PASS (clean; call-1 reset-exhausted disposal + fresh boot)', failed: false}
    }
    return {
      verdict: `FAIL (outcome not attributable: call1=${show(a.call1)} call2=${show(a.call2)})`,
      failed: true,
    }
  }
  // expect-disposal: the fresh boot must be POSITIVELY attributed to CALL 1's release reset
  // exhausting its pass budget — exactly one pool_reset_exhausted inside the call-1 window, no
  // transport-error masquerading, and zero disposal counters in the call-2 window so the
  // autopsy's own probe/reset can never be the source.
  if (!a.reused && a.call1.resetExhausted === 1 && a.call1.resetError === 0 && noDisposals(a.call2)) {
    return {verdict: 'PASS (call-1 reset pass budget exhausted; attributed disposal, fresh boot clean)', failed: false}
  }
  if (!a.reused) {
    return {
      verdict: `FAIL (disposal not attributable to call-1 reset exhaustion: call1=${show(a.call1)} call2=${show(
        a.call2,
      )})`,
      failed: true,
    }
  }
  // The storm converged and the VM was reused. The disposal path was NOT exercised, and that must
  // surface as a failure — never be retried into silence or overwritten by a luckier attempt.
  return {
    verdict: 'FAIL (storm converged — disposal path not exercised; strengthen the storm and rerun)',
    failed: true,
  }
}

/**
 * Judges a sequence of attempts: the first failed attempt decides the scenario, and a later
 * passing attempt can never overwrite it. With every judgement terminal this reduces to the first
 * attempt, but the rule is encoded (and regression-tested) here so no future retry loop can
 * reintroduce the silent-overwrite bug.
 */
export function judgeScenario(expect: Expectation, attempts: AttemptEvidence[]): AttemptJudgement {
  if (attempts.length === 0) return {verdict: 'FAIL (no attempts ran)', failed: true}
  let last: AttemptJudgement = {verdict: 'FAIL (no attempts ran)', failed: true}
  for (const attempt of attempts) {
    last = judgeAttempt(expect, attempt)
    if (last.failed) return last
  }
  return last
}
