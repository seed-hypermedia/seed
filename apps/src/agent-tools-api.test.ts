import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as agentMemory from '@/agent-memory'
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
  test('moves a legacy authored lambda into memory on start, lists builtins, and 404s for strangers', async () => {
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

      // Agents no longer hold private code tools: the next start moves this one into the agent's
      // memory, as code plus tool.json, and drops it from the registry.
      const restarted = new apisvc.Service(db, dataDir)
      const listed = await restarted.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTools', agentId}}),
      )
      if (listed._ !== 'ListAgentToolsResponse') throw new Error(`unexpected: ${listed._}`)
      expect(listed.agentId).toBe(agentId)
      expect(listed.tools.find((tool) => tool.name === 'word_count')).toBeUndefined()
      const stateDir = (db.query('SELECT state_dir FROM agents WHERE id = ?').get(agentId) as {state_dir: string})
        .state_dir
      const moved = JSON.parse(agentMemory.readMemoryFile(stateDir, 'tools/word_count/tool.json').content ?? '{}')
      expect(moved).toMatchObject({name: 'word_count', runtime: 'typescript', cid: saved.cid})
      expect(agentMemory.readMemoryFile(stateDir, 'tools/word_count/index.ts').content).toContain('word_count')
      // Idempotent: a later start finds nothing left to move and keeps the copy.
      new apisvc.Service(db, dataDir)
      expect(agentMemory.readMemoryFile(stateDir, 'tools/word_count/index.ts').content).toContain('word_count')

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
      sqlite.closeDatabase(db)
    }
  })

  test('saving an authored tool is refused: a tool is a resource under an app or an agent', async () => {
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
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'SaveAgentTool',
              agentId: created.agentId,
              tool: {name: 'word_count', description: 'Counts words.', input: {type: 'object'}, source: 'x'},
            } as never,
          }),
        ),
      ).rejects.toThrow('A tool is a resource')
    } finally {
      fs.rmSync(dataDir, {recursive: true, force: true})
      sqlite.closeDatabase(db)
    }
  })
})
