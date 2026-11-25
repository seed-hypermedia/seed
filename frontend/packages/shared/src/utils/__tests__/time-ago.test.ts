import {describe, expect, it} from 'vitest'
import {formattedTimeAgo} from '../date'

/** Session rows say how long ago a chat moved the way a person would, not as a full timestamp. */
describe('formattedTimeAgo', () => {
  const now = new Date(2026, 10, 4, 10, 0)
  const ago = (ms: number) => formattedTimeAgo(new Date(now.getTime() - ms), now)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('reads like speech', () => {
    expect(ago(10_000)).toBe('just now')
    expect(ago(5 * MIN)).toBe('5 minutes ago')
    expect(ago(3 * HOUR)).toBe('3 hours ago')
    expect(ago(30 * HOUR)).toBe('yesterday')
    expect(ago(4 * DAY)).toBe('4 days ago')
    expect(ago(10 * DAY)).toBe('last week')
    expect(ago(60 * DAY)).toBe('2 months ago')
    expect(ago(400 * DAY)).toBe('last year')
  })

  it('says yesterday for last night once a day has turned over', () => {
    expect(formattedTimeAgo(new Date(2026, 10, 3, 23, 0), new Date(2026, 10, 4, 0, 30))).toBe('1 hour ago')
    expect(formattedTimeAgo(new Date(2026, 10, 3, 20, 0), new Date(2026, 10, 4, 21, 0))).toBe('yesterday')
  })
})
