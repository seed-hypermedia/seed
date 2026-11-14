import {describe, expect, test} from 'bun:test'
import {agentWriteScopeOf, agentWriteScopePrompt} from './api-service'
import * as apisvc from './api-service'

const KEY = 'z6MkagentKey'
const DOC = 'hm://z6MkspaceOwner/team/ivory-ferret'

describe('agent write scope', () => {
  test('a root grant is the whole space', () => {
    expect(agentWriteScopeOf([{delegate: KEY, role: 'WRITER', path: ''}], [KEY], '/team/ivory-ferret')).toBe('space')
  })
  test('a grant at the document (or a parent) is the document', () => {
    expect(
      agentWriteScopeOf([{delegate: KEY, role: 'WRITER', path: '/team/ivory-ferret'}], [KEY], '/team/ivory-ferret'),
    ).toBe('document')
    expect(agentWriteScopeOf([{delegate: KEY, role: 'WRITER', path: '/team'}], [KEY], '/team/ivory-ferret')).toBe(
      'document',
    )
  })
  test("other keys' grants and exact grants elsewhere give nothing", () => {
    expect(agentWriteScopeOf([{delegate: 'z6Mkother', role: 'WRITER', path: ''}], [KEY], '/team/ivory-ferret')).toBe(
      'none',
    )
    expect(agentWriteScopeOf([{delegate: KEY, role: 'WRITER', path: '/elsewhere'}], [KEY], '/team/ivory-ferret')).toBe(
      'none',
    )
  })
  test('the prompt names where work belongs', () => {
    expect(agentWriteScopePrompt('document', DOC, KEY)).toContain(`${DOC}/<name>`)
    expect(agentWriteScopePrompt('none', DOC, KEY)).toContain('People tab')
    expect(agentWriteScopePrompt('space', DOC, KEY)).toContain('hm://z6MkspaceOwner')
  })
})

describe('user time', () => {
  test("the agent sees the person's local time and zone", async () => {
    const {userTimeBlock} = await import('./api-service')
    const block = userTimeBlock('Europe/Madrid', new Date('2026-11-14T02:45:00Z'))!
    expect(block).toContain('zone="Europe/Madrid"')
    expect(block).toContain('03:45')
    expect(userTimeBlock(undefined)).toBeUndefined()
  })
})

describe('cron schedules', () => {
  test('daily and weekly cron lines read as weekly schedules', async () => {
    const {weeklyFromCron} = await import('./api-service')
    expect(weeklyFromCron('0 18 * * 0')).toEqual({kind: 'weekly', daysOfWeek: [0], timeOfDay: '18:00'})
    expect(weeklyFromCron('30 8 * * *')?.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(weeklyFromCron('0 9 * * 1-5')?.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(weeklyFromCron('0 9 1 * *')).toBeNull()
    expect(weeklyFromCron('*/5 * * * *')).toBeNull()
  })
})

describe('normalizeScheduleTrigger', () => {
  test('takes several times a day, sorted and deduplicated, keeping the first as timeOfDay', () => {
    expect(
      apisvc.normalizeScheduleTrigger({
        kind: 'weekly',
        daysOfWeek: [1, 2],
        timeOfDay: '',
        timesOfDay: ['14:00', '08:00', '14:00'],
        timezone: 'UTC',
      } as never),
    ).toEqual({kind: 'weekly', daysOfWeek: [1, 2], timeOfDay: '08:00', timesOfDay: ['08:00', '14:00'], timezone: 'UTC'})
    expect(
      apisvc.normalizeScheduleTrigger({kind: 'weekly', daysOfWeek: [1], timeOfDay: '09:30', timezone: 'UTC'}),
    ).toEqual({kind: 'weekly', daysOfWeek: [1], timeOfDay: '09:30', timezone: 'UTC'})
    expect(() =>
      apisvc.normalizeScheduleTrigger({kind: 'weekly', daysOfWeek: [1], timeOfDay: '25:00', timezone: 'UTC'}),
    ).toThrow('HH:MM')
  })
})
