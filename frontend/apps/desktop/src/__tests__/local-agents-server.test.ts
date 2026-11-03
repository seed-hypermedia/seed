import {describe, expect, it, vi} from 'vitest'
import type {AgentInfo} from '@shm/ui/agents/client'

// The module under test reaches hooks that pull in the tRPC/gRPC clients; neither exists outside
// Electron. The function under test is pure.
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
import {resolveLocalAgentsServerMigration} from '../models/local-agents-server'

/**
 * Settling the local-server setting after an upgrade from a build that always ran the server.
 *
 * The regression this guards in both directions: retiring a server that still holds somebody's
 * agents (they would vanish from every list with no way back short of the settings switch), and
 * keeping a server alive forever on machines that never used it.
 */

const agent = {id: 'legacy-1', accessRole: 'owner'} as AgentInfo
const spawned = {t: 'spawned' as const, url: 'http://localhost:3050'}

describe('resolveLocalAgentsServerMigration', () => {
  it('does nothing once the setting is decided, or while it is loading', () => {
    expect(resolveLocalAgentsServerMigration({setting: 'on', state: spawned, lists: [[]]})).toBeNull()
    expect(resolveLocalAgentsServerMigration({setting: 'off', state: spawned, lists: [[]]})).toBeNull()
    expect(resolveLocalAgentsServerMigration({setting: undefined, state: spawned, lists: [[]]})).toBeNull()
  })

  it('never touches a server the app only attached to', () => {
    const attached = {t: 'attached' as const, url: 'http://localhost:3051'}
    expect(resolveLocalAgentsServerMigration({setting: null, state: attached, lists: [[]]})).toBeNull()
  })

  it('waits for every account list before deciding', () => {
    expect(resolveLocalAgentsServerMigration({setting: null, state: spawned, lists: undefined})).toBeNull()
    expect(resolveLocalAgentsServerMigration({setting: null, state: spawned, lists: [[], undefined]})).toBeNull()
  })

  it('keeps the server as soon as any account has an agent in it', () => {
    expect(resolveLocalAgentsServerMigration({setting: null, state: spawned, lists: ['error', [agent]]})).toBe('keep')
  })

  it('retires the server only when every account answered with no agents', () => {
    expect(resolveLocalAgentsServerMigration({setting: null, state: spawned, lists: [[], []]})).toBe('retire')
    // No local accounts at all: nothing can be in the server for anybody.
    expect(resolveLocalAgentsServerMigration({setting: null, state: spawned, lists: []})).toBe('retire')
    // A failed list may hide agents: leave it for the next launch.
    expect(resolveLocalAgentsServerMigration({setting: null, state: spawned, lists: [[], 'error']})).toBeNull()
  })
})
