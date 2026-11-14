import {describe, expect, test} from 'bun:test'
import {agentWriteScopeOf, agentWriteScopePrompt} from './api-service'

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
