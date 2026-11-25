import {describe, expect, it} from 'vitest'
import type {HMCapability} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {agentWriteScopeOf, widensAgentWriteScope} from '../agents/write-access'

const SPACE = 'z6MkspaceOwner'
const AGENT = 'z6MkagentKey'
const doc = hmId(SPACE, {path: ['team', 'ivory-ferret']})

function cap(accountUid: string, path: string[] | null, role: HMCapability['role'] = 'writer'): HMCapability {
  return {
    id: `${accountUid}-${path?.join('/')}`,
    accountUid,
    role,
    grantId: hmId(SPACE, {path}),
    createTime: {seconds: 0, nanos: 0},
  }
}

describe('agentWriteScopeOf', () => {
  it('reads a root grant as the whole space', () => {
    expect(agentWriteScopeOf([cap(AGENT, null)], [AGENT], doc)).toBe('space')
  })
  it('reads a grant at the document or a parent as the document', () => {
    expect(agentWriteScopeOf([cap(AGENT, ['team', 'ivory-ferret'])], [AGENT], doc)).toBe('document')
    expect(agentWriteScopeOf([cap(AGENT, ['team'])], [AGENT], doc)).toBe('document')
  })
  it("ignores other accounts' grants", () => {
    expect(agentWriteScopeOf([cap('z6Mkother', null)], [AGENT], doc)).toBe('none')
    expect(agentWriteScopeOf(undefined, [AGENT], doc)).toBe('none')
  })
  it('only ever widens', () => {
    expect(widensAgentWriteScope('document', 'space')).toBe(true)
    expect(widensAgentWriteScope('space', 'document')).toBe(false)
    expect(widensAgentWriteScope('none', 'none')).toBe(false)
  })
})
