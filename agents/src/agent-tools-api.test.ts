import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as sqlite from '@/sqlite'
import * as toolDocs from '@/tool-documents'
import * as blobs from '@shm/shared/blobs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * ListAgentTools is the GUI's window into ~/tools: the same documents the agent reads, source
 * included, so the owner can inspect what their agent authored for itself.
 */
describe('ListAgentTools', () => {
  test('returns builtins and an authored lambda with its source, and 404s for strangers', async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    const opened = sqlite.openWithDatabase(db)
    if (!opened.ok) throw new Error('unexpected schema mismatch')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-tools-api-'))
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
        }),
      )
      const created = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Toolsmith', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (created._ !== 'CreateAgentResponse') throw new Error(`unexpected: ${created._}`)
      const agentId = created.agentId
      const accountId = blobs.principalToString(account.principal)

      const saved = toolDocs.saveLambdaToolDocument(db, accountId, agentId, {
        name: 'word_count',
        description: 'Counts words in a string.',
        input: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']},
        output: {type: 'object', properties: {word_count: {type: 'number'}}},
        source: 'export default (input) => ({word_count: input.text.split(/\\s+/).length})',
        runtime: 'typescript',
      })

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTools', agentId}}),
      )
      if (listed._ !== 'ListAgentToolsResponse') throw new Error(`unexpected: ${listed._}`)
      expect(listed.agentId).toBe(agentId)

      const lambda = listed.tools.find((tool) => tool.name === 'word_count')
      expect(lambda).toMatchObject({
        kind: 'lambda',
        runtime: 'typescript',
        source: 'export default (input) => ({word_count: input.text.split(/\\s+/).length})',
        cid: saved.cid,
        enabled: true,
        granted: true,
      })
      expect(lambda?.input).toMatchObject({type: 'object'})

      // Builtins ride along, each reporting whether the grant set actually offers it.
      const builtins = listed.tools.filter((tool) => tool.kind === 'builtin')
      expect(builtins.length).toBeGreaterThan(0)
      for (const builtin of builtins) {
        expect(builtin.source).toBeUndefined()
        expect(typeof builtin.granted).toBe('boolean')
      }
      // search never depends on host code-exec availability, so it must be granted here.
      expect(builtins.find((tool) => tool.name === 'search')?.granted).toBe(true)

      // Another account cannot enumerate this agent's tools.
      const stranger = blobs.generateNobleKeyPair()
      await expect(
        svc.message(await apisvc.createSignedEnvelope(stranger, {action: {_: 'ListAgentTools', agentId}})),
      ).rejects.toThrow('Agent not found')
    } finally {
      fs.rmSync(dataDir, {recursive: true, force: true})
      db.close()
    }
  })

  test('creates, edits, renames, and deletes authored tools without overwriting another document', async () => {
    const db = new Database(':memory:', {create: true, strict: true})
    const opened = sqlite.openWithDatabase(db)
    if (!opened.ok) throw new Error('unexpected schema mismatch')
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-tools-api-'))
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
        }),
      )
      const created = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Tool editor', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (created._ !== 'CreateAgentResponse') throw new Error(`unexpected: ${created._}`)
      const agentId = created.agentId
      const original = {
        name: 'word_count',
        summary: 'Count words.',
        description: 'Counts words in a string.',
        input: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']},
        output: {type: 'object', properties: {count: {type: 'number'}}},
        source: 'export default (input) => ({count: input.text.split(/\\s+/).length})',
        runtime: 'typescript' as const,
      }

      const saved = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'SaveAgentTool', agentId, tool: original}}),
      )
      if (saved._ !== 'SaveAgentToolResponse') throw new Error(`unexpected: ${saved._}`)
      expect(saved.tool).toMatchObject({name: 'word_count', summary: 'Count words.', kind: 'lambda'})
      const createdAt = saved.tool.createdAt

      const renamed = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SaveAgentTool',
            agentId,
            previousName: 'word_count',
            tool: {
              ...original,
              name: 'token_count',
              summary: 'Count tokens.',
              description: 'Counts whitespace-delimited tokens.',
              runtime: 'python',
              source: 'def main(input):\n    return {"count": len(input["text"].split())}',
            },
          },
        }),
      )
      if (renamed._ !== 'SaveAgentToolResponse') throw new Error(`unexpected: ${renamed._}`)
      expect(renamed.tool).toMatchObject({
        name: 'token_count',
        summary: 'Count tokens.',
        runtime: 'python',
        createdAt,
      })

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SaveAgentTool', agentId, tool: {...original, name: 'other_count'}},
        }),
      )
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'SaveAgentTool',
              agentId,
              previousName: 'token_count',
              tool: {...original, name: 'other_count'},
            },
          }),
        ),
      ).rejects.toThrow('already exists')

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTools', agentId}}),
      )
      if (listed._ !== 'ListAgentToolsResponse') throw new Error(`unexpected: ${listed._}`)
      expect(listed.tools.some((tool) => tool.name === 'word_count')).toBe(false)
      expect(listed.tools.filter((tool) => tool.kind === 'lambda').map((tool) => tool.name)).toEqual([
        'other_count',
        'token_count',
      ])

      const deleted = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteAgentTool', agentId, name: 'token_count'}}),
      )
      expect(deleted).toEqual({_: 'DeleteAgentToolResponse', agentId, name: 'token_count', deleted: true})
      const deletedAgain = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteAgentTool', agentId, name: 'token_count'}}),
      )
      expect(deletedAgain).toMatchObject({deleted: false})
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteAgentTool', agentId, name: 'search'}}),
        ),
      ).rejects.toThrow('builtin')

      const reader = blobs.generateNobleKeyPair()
      const readerAccountId = blobs.principalToString(reader.principal)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'InviteAgentCollaborator', agentId, accountId: readerAccountId, role: 'reader'},
        }),
      )
      await svc.message(await apisvc.createSignedEnvelope(reader, {action: {_: 'AcceptAgentInvite', agentId}}))
      await expect(
        svc.message(await apisvc.createSignedEnvelope(reader, {action: {_: 'SaveAgentTool', agentId, tool: original}})),
      ).rejects.toThrow('Write access is required')

      const writer = blobs.generateNobleKeyPair()
      const writerAccountId = blobs.principalToString(writer.principal)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'InviteAgentCollaborator', agentId, accountId: writerAccountId, role: 'writer'},
        }),
      )
      await svc.message(await apisvc.createSignedEnvelope(writer, {action: {_: 'AcceptAgentInvite', agentId}}))
      const writerSaved = await svc.message(
        await apisvc.createSignedEnvelope(writer, {
          action: {_: 'SaveAgentTool', agentId, tool: {...original, name: 'shared_tool'}},
        }),
      )
      expect(writerSaved).toMatchObject({_: 'SaveAgentToolResponse', tool: {name: 'shared_tool'}})

      const stranger = blobs.generateNobleKeyPair()
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(stranger, {action: {_: 'SaveAgentTool', agentId, tool: original}}),
        ),
      ).rejects.toThrow('Agent not found')
    } finally {
      fs.rmSync(dataDir, {recursive: true, force: true})
      db.close()
    }
  })
})
