import {describe, expect, test} from 'bun:test'
import {planStoredTrigger, type StoredTrigger} from '../scripts/trigger-migration-report'

const base: StoredTrigger = {
  id: 't',
  accountId: 'z6Mkowner',
  agentId: 'hm://z6Mkowner/ion',
  name: 'T',
  enabled: true,
  continuation: null,
  lastFiredAt: null,
}

describe('stored-trigger migration plan', () => {
  test('says what each stored trigger becomes', () => {
    const kind = (trigger: Partial<StoredTrigger>) => planStoredTrigger({...base, ...trigger}).kind
    expect(kind({enabled: false})).toBe('delete-disabled')
    expect(kind({agentId: 'legacy-uuid'})).toBe('mount-or-retire-agent')
    expect(kind({})).toBe('document-as-is')
    expect(kind({continuation: {kind: 'newThread', systemPrompt: 'x', tools: ['read']}})).toBe(
      'document-with-session-options',
    )
    expect(kind({continuation: {kind: 'tool', tool: 'hm://z6Mkowner/ion/post'}})).toBe('document-as-is')
    expect(kind({continuation: {kind: 'tool', tool: 'hm://z6Mkowner/ion/post', onFailure: 'thread'}})).toBe(
      'document-with-failure-session',
    )
    expect(kind({continuation: {kind: 'tool', tool: 'execute'}})).toBe('port-builtin-call-to-tool')
    expect(kind({continuation: {kind: 'wake', signal: 's'}})).toBe('keep-stored-wake')
    // A script names what its tool needs.
    const script = planStoredTrigger({
      ...base,
      continuation: {
        kind: 'script',
        script: "const seen = await ctx.call('read', {address: '~/memory/receipts'}); await ctx.delegate('triage')",
        onFailure: 'thread',
      },
    })
    expect(script.kind).toBe('port-script-to-tool')
    expect(script.action).toContain('ctx.memory, ctx.agent.start')
    expect(script.action).toContain('onFailure: "session"')
  })
})
