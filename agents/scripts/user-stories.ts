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

/** The Onyx library space; kind URLs are `hm://<onyx>/hypermedia-<kind>`. */
const ONYX = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'
const KIND = (kind: string) => `${ONYX}/hypermedia-${kind}`

/** The Person type (story 5): name and surname required, an optional ISO birth date. */
const PERSON_SCHEMA = {
  type: KIND('struct'),
  properties: {
    name: {value: {type: KIND('string')}, required: true, description: 'Full name'},
    surname: {value: {type: KIND('string')}, required: true},
    born: {value: {type: KIND('string'), format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$'}},
  },
}

/** The Vote type (story 7): the signed-blob envelope plus a pinned type tag and two fields. */
const VOTE_SCHEMA = {
  ref: `${ONYX}/hypermedia-blob`,
  properties: {
    type: {value: 'Vote', required: true},
    target: {value: {ref: `${ONYX}/hypermedia-hm-url`}, required: true},
    choice: {value: {anyOf: ['yes', 'no']}, required: true},
  },
}

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
    assert(read.schema === undefined, 'an untyped document reports no schema')
  })

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

  // Story 5 comes before the rest of 1 and 4: the Person type must exist to be checked against.
  const S5 = '5. Define a custom schema as a document'
  let personSchemaCid = ''
  await step(S5, 'write ipfs:// with JSON content and options.schema = the meta-schema publishes a schema blob', async () => {
    const result = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify(PERSON_SCHEMA),
      options: {schema: 'hypermedia-schema'},
    })
    assert(result.type === 'ipfs_object_write_result', `result type ${result.type}`)
    assert(typeof result.cid === 'string' && result.url === `ipfs://${result.cid}`, 'result lacks the cid')
    assert(result.schema === 'hypermedia-schema', `result.schema = ${result.schema}`)
    assert(result.warnings === undefined, `unexpected warnings ${JSON.stringify(result.warnings)}`)
    personSchemaCid = result.cid
    // A schema that is not a schema is refused, with the violations spelled out.
    const refused = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify({type: `${ONYX}/hypermedia-struct`, properties: 'not a map'}),
      options: {schema: 'hypermedia-schema'},
    }).then(
      () => null,
      (error: Error) => error.message,
    )
    assert(refused && refused.includes('does not conform to hypermedia-schema'), `refusal: ${refused}`)
  })
  await step(S5, 'write hm://…/types/person with options.metadata.schemaDefinition binds the blob to the page', async () => {
    await verb('write', {address: url('types'), content: 'The types of this space.', options: {name: 'Types'}})
    const result = await verb('write', {
      address: url('types/person'),
      content: 'A person: a name, a surname, and an optional birth date.',
      options: {name: 'Person', metadata: {schemaDefinition: `ipfs://${personSchemaCid}`}},
    })
    assert(result.warnings === undefined, `unexpected warnings ${JSON.stringify(result.warnings)}`)
    const read = await verb('read', {address: url('types/person')})
    assert(read.metadata?.schemaDefinition === `ipfs://${personSchemaCid}`, 'page lacks schemaDefinition')
    // The blob behind the page reads back as an object that conforms to the meta-schema.
    const blob = await verb('read', {address: `ipfs://${personSchemaCid}`, options: {schema: 'hypermedia-schema'}})
    assert(blob.type === 'ipfs_object', `blob type ${blob.type}`)
    assert(blob.signature === null, 'a schema blob is not signed')
    assert(blob.schema?.violations?.length === 0, `schema check ${JSON.stringify(blob.schema)}`)
    // Pointing schemaDefinition at something that is not a schema warns beside the published id.
    const junk = await verb('write', {address: 'ipfs://', content: JSON.stringify({hello: 'world'})})
    const warned = await verb('write', {
      address: url('types/person'),
      options: {action: 'update', metadata: {schemaDefinition: `ipfs://${junk.cid}`}},
      dryRun: true,
    })
    assert(
      Array.isArray(warned.warnings) && warned.warnings.some((w: string) => w.startsWith('schemaDefinition ')),
      `expected a schemaDefinition warning, got ${JSON.stringify(warned.warnings)}`,
    )
  })

  await step(S1, 'read hm://<doc> names the schema the document conforms to and its required fields', async () => {
    const read = await verb('read', {address: url('notes')})
    assert(read.schema?.schema === url('types/person'), `schema = ${JSON.stringify(read.schema)}`)
    assert(read.schema?.via === 'own', `via = ${read.schema?.via}`)
    assert(
      Array.isArray(read.schema?.required) && read.schema.required.includes('surname'),
      `required = ${JSON.stringify(read.schema?.required)}`,
    )
    assert(read.schema?.missing?.length === 0, `missing = ${JSON.stringify(read.schema?.missing)}`)
  })

  const S4 = '4. See whether a document respects its schema'
  await step(S4, 'a write to a typed document returns schema violations as warnings beside the published id', async () => {
    const rehearsed = await verb('write', {
      address: url('notes'),
      options: {action: 'update', metadata: {born: 'yesterday'}},
      dryRun: true,
    })
    assert(rehearsed.dryRun === true, 'dry run did not say so')
    assert(
      Array.isArray(rehearsed.warnings) && rehearsed.warnings.some((w: string) => w.includes('born')),
      `dry run warnings = ${JSON.stringify(rehearsed.warnings)}`,
    )
    const result = await verb('write', {
      address: url('notes'),
      options: {action: 'update', metadata: {born: 'yesterday'}},
    })
    assert(typeof result.version === 'string', 'the document published despite the warning (advisory)')
    assert(result.schema?.via === 'own', `schema = ${JSON.stringify(result.schema)}`)
    assert(
      Array.isArray(result.warnings) && result.warnings.some((w: string) => w.includes('born')),
      `warnings = ${JSON.stringify(result.warnings)}`,
    )
    const fixed = await verb('write', {
      address: url('notes'),
      options: {action: 'update', metadata: {born: '1990-01-01'}},
    })
    assert(fixed.warnings === undefined, `warnings after the fix = ${JSON.stringify(fixed.warnings)}`)
  })
  await step(S4, 'a read of a typed document says which required fields are missing', async () => {
    const bob = await verb('read', {address: url('people/bob')})
    assert(bob.schema?.schema === url('types/person'), `schema = ${JSON.stringify(bob.schema)}`)
    assert(bob.schema?.via === 'inherited', `via = ${bob.schema?.via}`)
    assert(
      Array.isArray(bob.schema?.missing) && bob.schema.missing.includes('surname'),
      `missing = ${JSON.stringify(bob.schema?.missing)}`,
    )
    assert(bob.schema?.violations?.length > 0, `violations = ${JSON.stringify(bob.schema?.violations)}`)
  })

  const S6 = '6. Create a blob that follows a custom schema exactly'
  await step(S6, 'write ipfs:// with JSON content and options.schema = hm://…/types/person publishes a validated object', async () => {
    const refused = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify({name: 'Bob', surname: 'Smith', born: 'a while ago'}),
      options: {schema: url('types/person')},
    }).then(
      () => null,
      (error: Error) => error.message,
    )
    assert(refused && refused.includes('born'), `refusal: ${refused}`)
    const result = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify({name: 'Bob', surname: 'Smith', born: '1990-01-01'}),
      options: {schema: url('types/person')},
    })
    assert(typeof result.cid === 'string', 'no cid')
    assert(result.warnings === undefined, `warnings = ${JSON.stringify(result.warnings)}`)
    const read = await verb('read', {address: `ipfs://${result.cid}`})
    assert(read.type === 'ipfs_object', `read type ${read.type}`)
    assert(read.value?.schema?.['/'] === personSchemaCid, `schema link = ${JSON.stringify(read.value?.schema)}`)
    assert(read.schema?.ref === `ipfs://${personSchemaCid}`, `schema ref = ${read.schema?.ref}`)
    assert(read.schema?.violations?.length === 0, `violations = ${JSON.stringify(read.schema?.violations)}`)
    assert(read.signature === null, 'a plain object is not signed')
    assert(read.ok === true, 'ok')
    // --force publishes a violating object, and says so.
    const forced = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify({name: 'Bob', surname: 'Smith', born: 'a while ago'}),
      options: {schema: url('types/person'), force: true},
    })
    assert(Array.isArray(forced.warnings) && forced.warnings.length === 1, `forced warnings = ${JSON.stringify(forced.warnings)}`)
  })

  const S7 = '7. Extend the signed blob envelope into a new signed type'
  let voteSchemaCid = ''
  await step(S7, 'write ipfs:// with a schema that refs hypermedia-blob publishes the signed type’s schema blob', async () => {
    const result = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify(VOTE_SCHEMA),
      options: {schema: 'hypermedia-schema'},
    })
    assert(typeof result.cid === 'string' && result.warnings === undefined, `result ${JSON.stringify(result)}`)
    voteSchemaCid = result.cid
    const page = await verb('write', {
      address: url('types/vote'),
      content: 'A signed vote on a document.',
      options: {name: 'Vote', metadata: {schemaDefinition: `ipfs://${voteSchemaCid}`}},
    })
    assert(page.warnings === undefined, `page warnings ${JSON.stringify(page.warnings)}`)
    const blob = await verb('read', {address: `ipfs://${voteSchemaCid}`})
    assert(blob.value?.ref === `${ONYX}/hypermedia-blob`, 'the schema extends hypermedia-blob')
  })

  const S8 = '8. Create an instance of the signed type and sign it'
  await step(S8, 'write ipfs:// with options.schema = hm://…/types/vote and options.sign = true publishes a signed blob', async () => {
    const refused = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify({target: url('notes'), choice: 'maybe'}),
      options: {schema: url('types/vote'), sign: true},
    }).then(
      () => null,
      (error: Error) => error.message,
    )
    assert(refused && refused.includes('choice'), `refusal: ${refused}`)
    const result = await verb('write', {
      address: 'ipfs://',
      content: JSON.stringify({target: url('notes'), choice: 'yes'}),
      options: {schema: url('types/vote'), sign: true},
    })
    assert(typeof result.cid === 'string', 'no cid')
    assert(result.blobType === 'Vote', `type tag = ${result.blobType}`)
    assert(result.signer?.publicKey === account, `signer = ${JSON.stringify(result.signer)}`)
    assert(result.warnings === undefined, `warnings = ${JSON.stringify(result.warnings)}`)
    const read = await verb('read', {address: `ipfs://${result.cid}`, options: {schema: url('types/vote')}})
    assert(read.type === 'ipfs_object', `read type ${read.type}`)
    assert(read.value?.type === 'Vote' && read.value?.choice === 'yes', `value = ${JSON.stringify(read.value)}`)
    assert(read.signature?.ok === true, `signature = ${JSON.stringify(read.signature)}`)
    assert(read.signature?.signer === account, `signer = ${read.signature?.signer}`)
    assert(read.schema?.violations?.length === 0, `violations = ${JSON.stringify(read.schema?.violations)}`)
    assert(read.ok === true, 'ok')
  })
} catch (error) {
  report('setup', 'service, identity, agent, session', 'fail', (error as Error).message)
  process.exitCode = 1
} finally {
  db.close()
  fs.rmSync(dataDir, {recursive: true, force: true})
}
process.exit(process.exitCode ?? 0)
