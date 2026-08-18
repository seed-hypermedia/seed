import {
  normalizeAgentServerUrl,
  sendAgentAction,
  type AgentDefinition,
  type AgentToolInput,
  type AgentTriggerInput,
} from './client'
import {modelReasoningSupport} from '@seed-hypermedia/agents-protocol'

/**
 * Client-orchestrated move of one agent between agent servers.
 *
 * Agent servers never talk to each other, but every signed action works against any server the
 * account can reach — so the desktop app itself is the mover: it reads the agent's portable state
 * from the source server, recreates it on the target server, and only after every copy succeeded
 * deletes the original. A failure while copying rolls back the partial copy on the target and
 * leaves the source agent untouched.
 *
 * What moves: the definition (name, prompt, model settings, tool grants, metadata), memory files,
 * authored lambda tools, and triggers. What cannot move: sessions and run history (there is no
 * import API for durable events), signing identities (private keys never leave their server), and
 * account-level state each server keeps for itself (model provider keys, collaborators).
 */

export type MoveAgentProgress = {
  /** Human-readable step, e.g. "Copying memory files (3/12)". */
  label: string
}

/** Transport used for every signed action; injectable so tests can drive the orchestration. */
export type MoveAgentSend = typeof sendAgentAction

export type MoveAgentOptions = {
  accountUid: string
  agentId: string
  sourceServerUrl: string
  targetServerUrl: string
  /**
   * Provider name the moved agent should reference on the target server. Defaults to the source
   * definition's provider name, which the target rejects if no provider of that name exists there.
   */
  targetModelProvider?: string
  /**
   * The target provider's type. When set, a reasoning level the target provider/model pair cannot
   * honor is dropped instead of failing `CreateAgent` validation.
   */
  targetProviderType?: string
  onProgress?: (progress: MoveAgentProgress) => void
  send?: MoveAgentSend
}

export type MoveAgentResult = {
  newAgentId: string
  copiedMemoryFiles: number
  copiedTools: number
  copiedTriggers: number
}

/**
 * The copy fully succeeded but the original could not be deleted: the agent now exists on both
 * servers. Callers should still treat the move as landed (navigate to `newAgentId`) and tell the
 * user the original remains on the source server.
 */
export class MoveAgentSourceDeleteError extends Error {
  newAgentId: string

  constructor(newAgentId: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Agent copied, but the original could not be deleted from the source server: ${detail}`)
    this.name = 'MoveAgentSourceDeleteError'
    this.newAgentId = newAgentId
  }
}

export async function moveAgentToServer(options: MoveAgentOptions): Promise<MoveAgentResult> {
  const send = options.send ?? sendAgentAction
  const {accountUid, agentId} = options
  const sourceServerUrl = normalizeAgentServerUrl(options.sourceServerUrl)
  const targetServerUrl = normalizeAgentServerUrl(options.targetServerUrl)
  if (sourceServerUrl === targetServerUrl) {
    throw new Error('The agent already lives on that server')
  }
  const report = (label: string) => options.onProgress?.({label})

  report('Reading the agent')
  const agentRes = await send({serverUrl: sourceServerUrl, accountUid, action: {_: 'GetAgent', agentId}})
  if (agentRes._ !== 'GetAgentResponse') throw new Error('Unexpected agent response')
  if (agentRes.agent.accessRole && agentRes.agent.accessRole !== 'owner') {
    throw new Error('Only the agent owner can move it')
  }
  const definition = agentRes.agent.definition

  const memoryRes = await send({serverUrl: sourceServerUrl, accountUid, action: {_: 'ListAgentMemory', agentId}})
  if (memoryRes._ !== 'ListAgentMemoryResponse') throw new Error('Unexpected memory list response')
  const memoryFiles = memoryRes.entries.filter((entry) => entry.type === 'file')

  const toolsRes = await send({serverUrl: sourceServerUrl, accountUid, action: {_: 'ListAgentTools', agentId}})
  if (toolsRes._ !== 'ListAgentToolsResponse') throw new Error('Unexpected tool list response')
  const authoredTools = toolsRes.tools.filter((tool) => tool.kind === 'lambda')

  const triggersRes = await send({serverUrl: sourceServerUrl, accountUid, action: {_: 'ListAgentTriggers', agentId}})
  if (triggersRes._ !== 'ListAgentTriggersResponse') throw new Error('Unexpected trigger list response')
  const triggers = triggersRes.triggers

  // Signing keys name secrets on the source server; they would fail validation on the target and
  // the private keys behind them cannot move, so the copy starts without a publishing account.
  const {signingKey: _signingKey, signingKeys: _signingKeys, ...portable} = definition
  const targetDefinition: AgentDefinition = {...portable}
  if (options.targetModelProvider) targetDefinition.modelProvider = options.targetModelProvider
  if (targetDefinition.reasoningLevel && options.targetProviderType) {
    const support = modelReasoningSupport(options.targetProviderType, targetDefinition.model)
    if (!support || !support.levels.includes(targetDefinition.reasoningLevel)) {
      delete targetDefinition.reasoningLevel
    }
  }

  report('Creating the agent on the new server')
  const createRes = await send({
    serverUrl: targetServerUrl,
    accountUid,
    action: {_: 'CreateAgent', definition: targetDefinition, clientRequestId: crypto.randomUUID()},
  })
  if (createRes._ !== 'CreateAgentResponse') throw new Error('Unexpected create response')
  const newAgentId = createRes.agentId

  try {
    for (let index = 0; index < memoryFiles.length; index++) {
      const entry = memoryFiles[index]!
      report(`Copying memory files (${index + 1}/${memoryFiles.length})`)
      const fileRes = await send({
        serverUrl: sourceServerUrl,
        accountUid,
        action: {_: 'ReadAgentMemoryFile', agentId, path: entry.path},
      })
      if (fileRes._ !== 'ReadAgentMemoryFileResponse') throw new Error('Unexpected memory read response')
      const content = fileRes.file.encoding === 'utf8' ? fileRes.file.content ?? '' : fileRes.file.data
      if (content === undefined) throw new Error(`Memory file has no content: ${entry.path}`)
      await send({
        serverUrl: targetServerUrl,
        accountUid,
        action: {_: 'WriteAgentMemoryFile', agentId: newAgentId, path: entry.path, content},
      })
    }

    for (let index = 0; index < authoredTools.length; index++) {
      const tool = authoredTools[index]!
      report(`Copying authored tools (${index + 1}/${authoredTools.length})`)
      if (!tool.source || !tool.runtime) throw new Error(`Authored tool is missing its source: ${tool.name}`)
      const toolInput: AgentToolInput = {
        name: tool.name,
        ...(tool.summary ? {summary: tool.summary} : {}),
        description: tool.description,
        input: tool.input,
        ...(tool.output ? {output: tool.output} : {}),
        source: tool.source,
        runtime: tool.runtime,
      }
      await send({
        serverUrl: targetServerUrl,
        accountUid,
        action: {_: 'SaveAgentTool', agentId: newAgentId, tool: toolInput},
      })
    }

    // Triggers copy last so none can fire on a half-copied agent.
    for (let index = 0; index < triggers.length; index++) {
      const trigger = triggers[index]!
      report(`Copying triggers (${index + 1}/${triggers.length})`)
      const triggerInput: AgentTriggerInput = {
        name: trigger.name,
        enabled: trigger.enabled,
        source: trigger.source,
        prompt: trigger.prompt,
        ...(trigger.continuation ? {continuation: trigger.continuation} : {}),
      }
      await send({
        serverUrl: targetServerUrl,
        accountUid,
        action: {
          _: 'CreateAgentTrigger',
          agentId: newAgentId,
          trigger: triggerInput,
          clientRequestId: crypto.randomUUID(),
        },
      })
    }
  } catch (error) {
    report('Move failed — removing the partial copy')
    await send({serverUrl: targetServerUrl, accountUid, action: {_: 'DeleteAgent', agentId: newAgentId}}).catch(
      () => {},
    )
    throw error
  }

  report('Deleting the original agent')
  try {
    await send({serverUrl: sourceServerUrl, accountUid, action: {_: 'DeleteAgent', agentId}})
  } catch (error) {
    throw new MoveAgentSourceDeleteError(newAgentId, error)
  }

  return {
    newAgentId,
    copiedMemoryFiles: memoryFiles.length,
    copiedTools: authoredTools.length,
    copiedTriggers: triggers.length,
  }
}
