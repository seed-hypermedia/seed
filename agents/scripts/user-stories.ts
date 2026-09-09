/**
 * User stories, through an agent — the executable form of the agent column in
 * hypermedia/user-stories.md, as a runner the integration suite spawns.
 *
 * Runs the REAL Service against a REAL HM API server (the web app of the integration
 * environment), with a signing identity the service creates and an agent that may publish. No
 * model is in the loop: every step is a `read` or `write` verb invoked AS THE USER on a session
 * (InvokeSessionTool), which is exactly what a person does from the agent UI.
 *
 * Prints one JSON line per step: {story, step, status: "pass" | "fail" | "todo", detail?}. A
 * "todo" is a step the page marks missing, phrased as the call it should become; it becomes a
 * real step in the same change that builds it.
 *
 *   bun scripts/user-stories.ts --hm-server http://localhost:3399
 */
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '../src/api-service'
import * as sqlite from '../src/sqlite'
import type * as api from '../src/api'

const args = process.argv.slice(2)
const hmServerUrl = args[args.indexOf('--hm-server') + 1]
if (!hmServerUrl || !hmServerUrl.startsWith('http')) {
  console.error('usage: bun scripts/user-stories.ts --hm-server <url>')
  process.exit(2)
}

type Status = 'pass' | 'fail' | 'todo'
const report = (story: string, step: string, status: Status, detail?: string) =>
  console.log(JSON.stringify({story, step, status, ...(detail ? {detail} : {})}))

const db = new Database(':memory:', {create: true, strict: true})
const opened = sqlite.openWithDatabase(db)
if (!opened.ok) throw new Error('schema mismatch')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agent-stories-'))
const svc = new apisvc.Service(db, dataDir, {hmServerUrl, ipfsServerUrl: hmServerUrl})
const owner = blobs.generateNobleKeyPair()

async function message<T extends api.AgentResponse['_']>(action: api.UnsignedAgentAction, expected: T) {
  const response = await svc.message(await apisvc.createSignedEnvelope(owner, {action}))
  if (response._ !== expected) throw new Error(`expected ${expected}, got ${response._}`)
  return response as Extract<api.AgentResponse, {_: T}>
}

let sessionId = ''
let account = ''
const url = (p: string) => `hm://${account}${p ? '/' + p : ''}`

/** One verb, as the user, on the session; the follow-up agent turn is drained before returning. */
async function verb(verb: 'read' | 'write', input: Record<string, unknown>) {
  const result = await message({_: 'InvokeSessionTool', sessionId, verb, input}, 'InvokeSessionToolResponse')
  await svc.awaitQueueIdle()
  if (result.error) throw new Error(result.error)
  return (result.output ?? {}) as Record<string, any>
}

async function step(story: string, name: string, run: () => Promise<void>) {
  try {
    await run()
    report(story, name, 'pass')
  } catch (error) {
    report(story, name, 'fail', (error as Error).message)
  }
}
const todo = (story: string, name: string) => report(story, name, 'todo')
const assert = (condition: unknown, detail: string) => {
  if (!condition) throw new Error(detail)
}

try {
  await message({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}}, 'SetModelProviderResponse')
  // The signing identity is a real account on the HM server: its profile and home are published.
  const created = await message(
    {_: 'CreateSigningIdentity', label: 'Story Author', clientRequestId: 'story-author'},
    'CreateSigningIdentityResponse',
  )
  account = created.identity.accountId ?? ''
  if (!account) throw new Error('signing identity has no account id')
  const agent = await message(
    {
      _: 'CreateAgent',
      definition: {
        name: 'Story Agent',
        systemPrompt: 'You publish what you are asked to.',
        modelProvider: 'openai',
        model: 'gpt',
        signingKeys: [created.identity.name],
        tools: ['publish'],
      } as api.AgentDefinition,
    },
    'CreateAgentResponse',
  )
  const session = await message({_: 'CreateSession', agentId: agent.agentId}, 'CreateSessionResponse')
  sessionId = session.sessionId
  report('setup', `signing identity ${account} with the publish grant`, 'pass')

  const S1 = '1. Understand the document model'
  await step(S1, 'write a document, then read it back as markdown with its metadata', async () => {
    await verb('write', {
      address: url('notes'),
      content: 'A first paragraph.\n\nA second paragraph.',
      options: {name: 'Notes'},
    })
    const read = await verb('read', {address: url('notes')})
    assert(read.type === 'hypermedia_document', `read type ${read.type}`)
    assert(String(read.markdown).includes('A first paragraph.'), 'markdown lacks the body')
    assert((read.metadata?.name ?? read.name) === 'Notes', 'metadata lacks the name')
  })
  todo(S1, 'read hm://<doc> names the schema the document conforms to and its required fields')

  const S2 = '2. Give a document custom metadata'
  await step(S2, 'write with options.metadata sets custom keys and the schema field', async () => {
    await verb('write', {
      address: url('notes'),
      options: {action: 'update', metadata: {surname: 'Smith', schema: url('types/person')}},
    })
    const read = await verb('read', {address: url('notes')})
    assert(read.metadata?.surname === 'Smith', `surname = ${read.metadata?.surname}`)
    assert(read.metadata?.schema === url('types/person'), `schema = ${read.metadata?.schema}`)
  })

  const S3 = '3. Give the direct children of a document a type'
  await step(
    S3,
    'write childrenSchema on a folder; a child written under it carries no schema of its own',
    async () => {
      await verb('write', {
        address: url('people'),
        content: 'Everyone we know.',
        options: {name: 'People', metadata: {childrenSchema: url('types/person')}},
      })
      await verb('write', {address: url('people/bob'), content: 'Bob is a person.', options: {name: 'Bob'}})
      const folder = await verb('read', {address: url('people')})
      assert(folder.metadata?.childrenSchema === url('types/person'), 'folder lacks childrenSchema')
      const child = await verb('read', {address: url('people/bob')})
      assert(child.metadata?.schema === undefined, 'child should carry no schema of its own')
    },
  )

  const S4 = '4. See whether a document respects its schema'
  todo(S4, 'a write to a typed document returns schema violations as warnings beside the published id')
  todo(S4, 'a read of a typed document says which required fields are missing')

  const S5 = '5. Define a custom schema as a document'
  todo(S5, 'write ipfs:// with JSON content and options.schema = the meta-schema publishes a schema blob')
  todo(S5, 'write hm://…/types/person with options.metadata.schemaDefinition binds the blob to the page')

  todo(
    '6. Create a blob that follows a custom schema exactly',
    'write ipfs:// with JSON content and options.schema = hm://…/types/person publishes a validated object',
  )
  todo(
    '7. Extend the signed blob envelope into a new signed type',
    'write ipfs:// with a schema that refs hypermedia-blob publishes the signed type’s schema blob',
  )
  todo(
    '8. Create an instance of the signed type and sign it',
    'write ipfs:// with options.schema = hm://…/types/vote and options.sign = true publishes a signed blob',
  )
} catch (error) {
  report('setup', 'service, identity, agent, session', 'fail', (error as Error).message)
  process.exitCode = 1
} finally {
  db.close()
  fs.rmSync(dataDir, {recursive: true, force: true})
}
process.exit(process.exitCode ?? 0)
