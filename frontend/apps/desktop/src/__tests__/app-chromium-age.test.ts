import {afterEach, describe, expect, it} from 'vitest'
import {chromiumPolicySchema, getChromiumStatus, isChromiumStale, setChromiumPolicy} from '../app-chromium-age'

const releasedAt = '2026-09-29T00:00:00.000Z'
const day = 86400000
const current = {chrome: '152.0.7977.130', releasedAt, now: Date.parse(releasedAt) + day, policy: {}}

afterEach(() => setChromiumPolicy({}))

describe('Chromium freshness', () => {
  it('accepts legacy manifests without policy fields', () => {
    expect(chromiumPolicySchema.parse({name: '2026.10.1'})).toEqual({})
    expect(isChromiumStale(current)).toBe(false)
  })

  it('expires after, but not at, 60 days without needing a network response', () => {
    expect(isChromiumStale({...current, now: Date.parse(releasedAt) + 60 * day})).toBe(false)
    expect(isChromiumStale({...current, now: Date.parse(releasedAt) + 60 * day + 1})).toBe(true)
  })

  it.each([
    ['153', true],
    ['152.0.7977.131', true],
    ['152.0.7977.130', false],
    ['152', false],
    ['151.999.9999.999', false],
  ])('compares numeric components against %s', (minimumChromium, stale) => {
    expect(isChromiumStale({...current, policy: {minimumChromium}})).toBe(stale)
  })

  it('cannot refresh the bundled runtime using a newer remote release date', () => {
    expect(
      isChromiumStale({
        ...current,
        now: Date.parse(releasedAt) + 61 * day,
        policy: {chromiumReleasedAt: '2026-11-29T00:00:00.000Z'},
      }),
    ).toBe(true)
  })

  it('rejects malformed policy at the boundary and reports accepted policy to the renderer', () => {
    expect(() => setChromiumPolicy({minimumChromium: 'bad'})).toThrow()
    expect(() => setChromiumPolicy({chromiumReleasedAt: 'not a date'})).toThrow()
    setChromiumPolicy({minimumChromium: '153'})
    expect(getChromiumStatus()).toMatchObject({minimumChromium: '153', bundledReleasedAt: releasedAt})
  })

  it('fails closed for an unknown local runtime or invalid bundled date', () => {
    expect(isChromiumStale({...current, chrome: ''})).toBe(true)
    expect(isChromiumStale({...current, releasedAt: ''})).toBe(true)
  })
})
