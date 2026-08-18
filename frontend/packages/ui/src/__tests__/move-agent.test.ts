import {describe, expect, it} from 'vitest'

import {moveAgentToServer, MoveAgentSourceDeleteError, type MoveAgentSend} from '../agents/move-agent'

const SOURCE = 'https://source.example.com'
const TARGET = 'https://target.example.com'
const ACCOUNT = 'z6MkAccount'
const AGENT_ID = 'agent-1'
const NEW_AGENT_ID = 'agent-2'

const baseDefinition = {
  name: 'Mover',
  systemPrompt: 'Be helpful.',
  modelProvider: 'openai-main',
  model: 'gpt-5-mini',
  reasoningLevel: 'high' as const,
  tools: ['seed_search'],
  signingKey: 'secret-key-1',
  signingKeys: ['secret-key-1'],
  metadata: {createdFrom: 'test'},
}

type SentAction = {serverUrl: string; action: any}

/**
 * Fake transport backed by canned source-server state. Records every action so assertions can
 * check exactly what was sent where, in order.
 */
function makeFakeSend(options?: {failAction?: string; failServerUrl?: string}): {
  send: MoveAgentSend
  calls: SentAction[]
} {
  const calls: SentAction[] = []
  const send: MoveAgentSend = async ({serverUrl, action}) => {
    calls.push({serverUrl, action})
    if (options?.failAction === action._ && (!options.failServerUrl || options.failServerUrl === serverUrl)) {
      throw new Error(`boom: ${action._}`)
    }
    switch (action._) {
      case 'GetAgent':
        return {
          _: 'GetAgentResponse',
          agent: {
            id: AGENT_ID,
            account: ACCOUNT,
            definition: baseDefinition,
            stateDir: '/tmp/x',
            status: 'idle',
            createdAt: 1,
            updatedAt: 1,
            accessRole: 'owner',
          },
          sessions: [],
        } as any
      case 'ListAgentMemory':
        return {
          _: 'ListAgentMemoryResponse',
          agentId: AGENT_ID,
          entries: [
            {path: 'notes', type: 'dir', size: 0, updatedAt: 1},
            {path: 'notes/todo.md', type: 'file', size: 5, updatedAt: 1},
            {path: 'pic.bin', type: 'file', size: 3, updatedAt: 1},
          ],
          totalBytes: 8,
        } as any
      case 'ReadAgentMemoryFile':
        if (action.path === 'notes/todo.md') {
          return {
            _: 'ReadAgentMemoryFileResponse',
            agentId: AGENT_ID,
            file: {path: action.path, size: 5, updatedAt: 1, encoding: 'utf8', content: 'hello'},
          } as any
        }
        return {
          _: 'ReadAgentMemoryFileResponse',
          agentId: AGENT_ID,
          file: {path: action.path, size: 3, updatedAt: 1, encoding: 'binary', data: new Uint8Array([1, 2, 3])},
        } as any
      case 'ListAgentTools':
        return {
          _: 'ListAgentToolsResponse',
          agentId: AGENT_ID,
          tools: [
            {
              name: 'seed_search',
              kind: 'builtin',
              summary: 'Search',
              description: 'Search Seed',
              input: {},
              cid: 'cid-builtin',
              enabled: true,
              granted: true,
              createdAt: 1,
              updatedAt: 1,
            },
            {
              name: 'my_lambda',
              kind: 'lambda',
              summary: 'Adds',
              description: 'Adds numbers',
              input: {type: 'object'},
              output: {type: 'object'},
              source: 'export default async () => ({})',
              runtime: 'typescript',
              cid: 'cid-lambda',
              enabled: true,
              granted: true,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        } as any
      case 'ListAgentTriggers':
        return {
          _: 'ListAgentTriggersResponse',
          triggers: [
            {
              id: 'trigger-1',
              account: ACCOUNT,
              agentId: AGENT_ID,
              name: 'Hourly check',
              enabled: true,
              source: {type: 'schedule', schedule: {kind: 'interval', every: 1, unit: 'hours'}},
              prompt: 'Check things.',
              continuation: {kind: 'newThread'},
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        } as any
      case 'CreateAgent':
        return {_: 'CreateAgentResponse', agentId: NEW_AGENT_ID} as any
      case 'WriteAgentMemoryFile':
        return {
          _: 'WriteAgentMemoryFileResponse',
          agentId: action.agentId,
          entry: {path: action.path, type: 'file', size: 1, updatedAt: 2},
        } as any
      case 'SaveAgentTool':
        return {_: 'SaveAgentToolResponse', agentId: action.agentId, tool: {}} as any
      case 'CreateAgentTrigger':
        return {_: 'CreateAgentTriggerResponse', trigger: {}} as any
      case 'DeleteAgent':
        return {_: 'DeleteAgentResponse', agentId: action.agentId} as any
      default:
        throw new Error(`Unexpected action: ${action._}`)
    }
  }
  return {send, calls}
}

describe('moveAgentToServer', () => {
  it('copies definition, memory, authored tools, and triggers, then deletes the original', async () => {
    const {send, calls} = makeFakeSend()
    const progress: string[] = []
    const result = await moveAgentToServer({
      accountUid: ACCOUNT,
      agentId: AGENT_ID,
      sourceServerUrl: SOURCE,
      targetServerUrl: TARGET,
      targetModelProvider: 'openai-main',
      targetProviderType: 'openai',
      onProgress: (update) => progress.push(update.label),
      send,
    })

    expect(result).toEqual({newAgentId: NEW_AGENT_ID, copiedMemoryFiles: 2, copiedTools: 1, copiedTriggers: 1})

    const create = calls.find((call) => call.action._ === 'CreateAgent')!
    expect(create.serverUrl).toBe(TARGET)
    // Signing keys are server-side secrets — they must not travel with the definition.
    expect(create.action.definition.signingKey).toBeUndefined()
    expect(create.action.definition.signingKeys).toBeUndefined()
    expect(create.action.definition.name).toBe('Mover')
    expect(create.action.definition.tools).toEqual(['seed_search'])
    expect(create.action.definition.reasoningLevel).toBe('high')

    const writes = calls.filter((call) => call.action._ === 'WriteAgentMemoryFile')
    expect(writes.map((call) => call.action.path)).toEqual(['notes/todo.md', 'pic.bin'])
    expect(writes.every((call) => call.serverUrl === TARGET && call.action.agentId === NEW_AGENT_ID)).toBe(true)
    expect(writes[0]!.action.content).toBe('hello')
    expect(writes[1]!.action.content).toEqual(new Uint8Array([1, 2, 3]))

    const savedTools = calls.filter((call) => call.action._ === 'SaveAgentTool')
    expect(savedTools).toHaveLength(1)
    expect(savedTools[0]!.action.tool.name).toBe('my_lambda')
    expect(savedTools[0]!.action.tool.source).toBe('export default async () => ({})')

    const createdTriggers = calls.filter((call) => call.action._ === 'CreateAgentTrigger')
    expect(createdTriggers).toHaveLength(1)
    expect(createdTriggers[0]!.action.agentId).toBe(NEW_AGENT_ID)
    expect(createdTriggers[0]!.action.trigger).toMatchObject({
      name: 'Hourly check',
      enabled: true,
      prompt: 'Check things.',
      continuation: {kind: 'newThread'},
    })

    // The original is deleted only from the source, and only at the very end.
    const deletes = calls.filter((call) => call.action._ === 'DeleteAgent')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.serverUrl).toBe(SOURCE)
    expect(deletes[0]!.action.agentId).toBe(AGENT_ID)
    expect(calls[calls.length - 1]!.action._).toBe('DeleteAgent')

    expect(progress[0]).toBe('Reading the agent')
    expect(progress[progress.length - 1]).toBe('Deleting the original agent')
  })

  it('remaps the model provider and drops a reasoning level the target provider cannot honor', async () => {
    const {send, calls} = makeFakeSend()
    await moveAgentToServer({
      accountUid: ACCOUNT,
      agentId: AGENT_ID,
      sourceServerUrl: SOURCE,
      targetServerUrl: TARGET,
      targetModelProvider: 'groq-main',
      targetProviderType: 'groq',
      send,
    })
    const create = calls.find((call) => call.action._ === 'CreateAgent')!
    expect(create.action.definition.modelProvider).toBe('groq-main')
    expect(create.action.definition.reasoningLevel).toBeUndefined()
  })

  it('rolls back the target copy and keeps the source when copying fails', async () => {
    const {send, calls} = makeFakeSend({failAction: 'WriteAgentMemoryFile'})
    await expect(
      moveAgentToServer({
        accountUid: ACCOUNT,
        agentId: AGENT_ID,
        sourceServerUrl: SOURCE,
        targetServerUrl: TARGET,
        send,
      }),
    ).rejects.toThrow('boom: WriteAgentMemoryFile')

    const deletes = calls.filter((call) => call.action._ === 'DeleteAgent')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]!.serverUrl).toBe(TARGET)
    expect(deletes[0]!.action.agentId).toBe(NEW_AGENT_ID)
  })

  it('reports a landed copy when only the source delete fails', async () => {
    const {send} = makeFakeSend({failAction: 'DeleteAgent', failServerUrl: SOURCE})
    const promise = moveAgentToServer({
      accountUid: ACCOUNT,
      agentId: AGENT_ID,
      sourceServerUrl: SOURCE,
      targetServerUrl: TARGET,
      send,
    })
    await expect(promise).rejects.toBeInstanceOf(MoveAgentSourceDeleteError)
    await promise.catch((error: MoveAgentSourceDeleteError) => {
      expect(error.newAgentId).toBe(NEW_AGENT_ID)
    })
  })

  it('refuses to move an agent onto the server it already lives on', async () => {
    const {send, calls} = makeFakeSend()
    await expect(
      moveAgentToServer({
        accountUid: ACCOUNT,
        agentId: AGENT_ID,
        sourceServerUrl: SOURCE,
        targetServerUrl: `${SOURCE}/`,
        send,
      }),
    ).rejects.toThrow('already lives on that server')
    expect(calls).toHaveLength(0)
  })

  it('refuses to move an agent the account does not own', async () => {
    const fake = makeFakeSend()
    const send: MoveAgentSend = async (input) => {
      if (input.action._ === 'GetAgent') {
        const response = (await fake.send(input)) as any
        return {...response, agent: {...response.agent, accessRole: 'writer'}}
      }
      return fake.send(input)
    }
    await expect(
      moveAgentToServer({
        accountUid: ACCOUNT,
        agentId: AGENT_ID,
        sourceServerUrl: SOURCE,
        targetServerUrl: TARGET,
        send,
      }),
    ).rejects.toThrow('Only the agent owner can move it')
    expect(fake.calls.every((call) => call.action._ !== 'CreateAgent')).toBe(true)
  })
})
