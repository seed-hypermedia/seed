import {describe, expect, test} from 'bun:test'
import * as scheduleTriggers from '@/schedule-triggers'
import type * as api from '@/api'

function trigger(source: api.AgentTriggerSource, createdAt: number, lastFiredAt?: number): api.AgentTriggerInfo {
  return {
    id: 'trigger-1',
    account: 'account',
    agentId: 'agent',
    name: 'Schedule',
    enabled: true,
    source,
    prompt: 'Run',
    createdAt,
    updatedAt: createdAt,
    ...(lastFiredAt === undefined ? {} : {lastFiredAt}),
  }
}

describe('schedule trigger due calculation', () => {
  test('fires interval triggers at the next interval boundary', () => {
    const createdAt = Date.UTC(2026, 0, 1, 0, 0)
    const source: api.AgentTriggerSource = {type: 'schedule', schedule: {kind: 'interval', every: 15, unit: 'minutes'}}
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt), createdAt + 14 * 60_000)).toBeNull()
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt), createdAt + 15 * 60_000)).toMatchObject({
      scheduledAt: createdAt + 15 * 60_000,
      activityKey: `schedule:trigger-1:${createdAt + 15 * 60_000}`,
    })
  })

  test('fires one-time triggers only once', () => {
    const createdAt = Date.UTC(2026, 0, 1, 0, 0)
    const runAt = createdAt + 60_000
    const source: api.AgentTriggerSource = {type: 'schedule', schedule: {kind: 'once', runAt, timezone: 'UTC'}}
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt), runAt)).toMatchObject({scheduledAt: runAt})
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt, runAt), runAt + 60_000)).toBeNull()
  })

  test('fires weekly triggers on selected local days and times', () => {
    const createdAt = Date.UTC(2026, 0, 5, 0, 0) // Monday
    const source: api.AgentTriggerSource = {
      type: 'schedule',
      schedule: {kind: 'weekly', daysOfWeek: [1], timeOfDay: '09:30', timezone: 'UTC'},
    }
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt), Date.UTC(2026, 0, 5, 9, 29))).toBeNull()
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt), Date.UTC(2026, 0, 5, 9, 30))).toMatchObject({
      scheduledAt: Date.UTC(2026, 0, 5, 9, 30),
    })
  })

  test('fires a weekly trigger at each of several times a day', () => {
    const createdAt = Date.UTC(2026, 0, 5, 0, 0) // Monday
    const source: api.AgentTriggerSource = {
      type: 'schedule',
      schedule: {kind: 'weekly', daysOfWeek: [1], timeOfDay: '08:00', timesOfDay: ['08:00', '14:00'], timezone: 'UTC'},
    }
    const morning = Date.UTC(2026, 0, 5, 8, 0)
    const afternoon = Date.UTC(2026, 0, 5, 14, 0)
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt), morning)).toMatchObject({scheduledAt: morning})
    // After the 08:00 firing, the next is 14:00, not 08:00 again.
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt, morning), Date.UTC(2026, 0, 5, 13, 59))).toBeNull()
    expect(scheduleTriggers.dueOccurrence(trigger(source, createdAt, morning), afternoon)).toMatchObject({
      scheduledAt: afternoon,
      summary: 'Scheduled weekly run at 14:00 UTC',
    })
    expect(scheduleTriggers.scheduleSourceSummary(source.schedule)).toBe('Mon at 08:00, 14:00 UTC')
  })
})
