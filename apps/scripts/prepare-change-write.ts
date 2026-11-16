/**
 * The write tool's document update against a REAL Seed site, as a runner the integration suite
 * spawns (tests/prepare-change.integration.test.ts): the service is Bun-only, the suite is not.
 *
 * An agent edits a document the way agents do: it reads it, changes something, and writes the whole
 * document back. The update goes through the site's `PrepareDocumentChange`, so the Change the
 * site stores must hold only what differs. Each step decodes the stored Change blob to show that.
 *
 * Prints one JSON line per step: {step, status: "pass" | "fail", detail?}.
 *
 *   bun scripts/prepare-change-write.ts --hm-server http://localhost:59421
 */
import {Database} from 'bun:sqlite'
import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import * as blobs from '@seed-hypermedia/client/blobs'
import * as apisvc from '../src/api-service'
import * as sqlite from '../src/sqlite'

const args = process.argv.slice(2)
const hmServerUrl = args[args.indexOf('--hm-server') + 1]
if (!hmServerUrl || !hmServerUrl.startsWith('http')) {
  console.error('usage: bun scripts/prepare-change-write.ts --hm-server <url>')
  process.exit(2)
}

const db = new Database(':memory:', {create: true, strict: true})
if (!sqlite.openWithDatabase(db).ok) throw new Error('schema mismatch')
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-prepare-change-write-'))
const owner = blobs.generateNobleKeyPair()
const account = blobs.principalToString(owner.principal)
const svc = new apisvc.Service(db, stateDir, {hmServerUrl, ipfsServerUrl: hmServerUrl})
const imported = await svc.message(
  await apisvc.createSignedEnvelope(owner, {action: {_: 'ImportSigningIdentity', seed: owner.seed}}),
)
if (imported._ !== 'ImportSigningIdentityResponse') throw new Error('could not import the signing identity')
const context = {
  db,
  accountId: account,
  agentId: 'prepare-change-write',
  definition: {signingKeys: [imported.identity.name]},
  hmServerUrl,
  ipfsServerUrl: hmServerUrl,
  publishEnabled: true,
  stateDir,
} as apisvc.AgentServicePiToolContext
const client = createSeedClient(hmServerUrl)

type Op = Record<string, any>

/** The ops of a Change the site stored. */
async function storedOps(cid: string): Promise<Op[]> {
  const {value} = (await client.request('GetCID', {cid})) as {value: {body?: {ops?: Op[]}}}
  return value.body?.ops ?? []
}

async function document(docPath: string) {
  const resource = await client.request('Resource', {...unpackHmId(`hm://${account}${docPath}`)!, latest: true})
  if (resource.type !== 'document') throw new Error(`${docPath} is ${resource.type}`)
  return resource.document
}

/** The document as an agent reads it: markdown carrying every block's id. */
async function readMarkdown(address: string): Promise<string> {
  const result = (await apisvc.executeReadVerb(context, {address})) as Record<string, unknown>
  if (typeof result.markdown !== 'string') throw new Error(`read returned no markdown: ${JSON.stringify(result)}`)
  const markdown = result.markdown
  // The body only: the frontmatter is the read's own description of the document.
  return markdown.replace(/^---\n[\s\S]*?\n---\n/, '')
}

const write = (input: Record<string, unknown>) =>
  apisvc.executeWriteVerb(context, input) as Promise<Record<string, any>>

let failed = false
async function step(name: string, run: () => Promise<void>) {
  try {
    await run()
    console.log(JSON.stringify({step: name, status: 'pass'}))
  } catch (error) {
    failed = true
    console.log(JSON.stringify({step: name, status: 'fail', detail: (error as Error).stack ?? String(error)}))
  }
}

const address = `hm://${account}/report`
const BODY = `# Quarterly report

Revenue grew in every region.

## Regions

- North: up 4%
- South: up 9%
- West: flat

## Outlook

We expect the same next quarter.

| Region | Growth |
| --- | --- |
| North | 4% |
| South | 9% |
`

let created: Record<string, any>
let markdown = ''

await step('an agent creates a multi-block document', async () => {
  created = await write({
    address,
    content: BODY,
    options: {
      name: 'Quarterly report',
      metadata: {summary: 'Q3', quarter: 3, source: {type: 'manual', owner: 'finance'}},
    },
  })
  assert.equal(created.type, 'hypermedia_write_result', JSON.stringify(created))
  const doc = await document('/report')
  assert.equal(doc.version, created.version)
  markdown = await readMarkdown(address)
  assert.match(markdown, /South: up 9%/)
  assert.match(markdown, /id:/, `the read carries no block ids:\n${markdown}`)
})

await step('changing one block stores a change with only that block', async () => {
  const before = await document('/report')
  const edited = markdown.replace('South: up 9%', 'South: up 11%')
  assert.notEqual(edited, markdown)
  const result = await write({address, content: edited, options: {action: 'update'}})
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  assert.equal(result.unchanged, undefined)
  const after = await document('/report')
  assert.equal(after.version, result.version)
  assert.notEqual(after.version, before.version)
  assert.equal(after.genesis, before.genesis)
  const ops = await storedOps(result.version)
  assert.equal(ops.length, 1, `expected one op, stored ${JSON.stringify(ops)}`)
  assert.equal(ops[0]!.type, 'ReplaceBlock')
  assert.equal(ops[0]!.block.text, 'South: up 11%')
  // The rest of the document reads as it did.
  const now = await readMarkdown(address)
  assert.equal(now, edited)
  markdown = now
})

await step('writing the same document again stores nothing', async () => {
  const before = await document('/report')
  const result = await write({
    address,
    content: markdown,
    options: {action: 'update', name: 'Quarterly report', metadata: {summary: 'Q3', quarter: 3}},
  })
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  assert.equal(result.unchanged, true)
  assert.equal(result.version, before.version)
  assert.deepEqual(result.cids, [])
  assert.match(result.message, /already up to date/)
  const after = await document('/report')
  assert.equal(after.version, before.version)
  const changes = await client.request('ListChanges', {targetId: unpackHmId(address)!})
  assert.equal(changes.changes.length, 2, 'the document has its first change and the one-block edit, nothing else')
})

await step('adding a block at the end stores the block and one move', async () => {
  const result = await write({
    address,
    content: `${markdown.trimEnd()}\n\nPrepared by the finance team.\n`,
    options: {action: 'update'},
  })
  assert.equal(result.unchanged, undefined, JSON.stringify(result))
  const ops = await storedOps(result.version)
  const moves = ops.filter((op) => op.type === 'MoveBlocks')
  const replaces = ops.filter((op) => op.type === 'ReplaceBlock')
  assert.equal(ops.length, 2, `stored ${JSON.stringify(ops)}`)
  assert.equal(replaces.length, 1)
  assert.equal(replaces[0]!.block.text, 'Prepared by the finance team.')
  assert.deepEqual(moves[0]!.blocks, [replaces[0]!.block.id])
  markdown = await readMarkdown(address)
  assert.match(markdown, /Prepared by the finance team\./)
})

await step('removing a section deletes its blocks and re-places only the block after it', async () => {
  const start = markdown.indexOf('## Regions')
  const end = markdown.indexOf('## Outlook')
  assert.ok(start > 0 && end > start, markdown)
  const without = markdown.slice(0, start) + markdown.slice(end)
  const result = await write({address, content: without, options: {action: 'update'}})
  assert.equal(result.unchanged, undefined, JSON.stringify(result))
  const ops = await storedOps(result.version)
  // The section's blocks are deleted, and the block that followed it is placed after the block
  // that now precedes it. No block is rewritten, and no other block is moved.
  assert.deepEqual(ops.map((op) => op.type).sort(), ['DeleteBlocks', 'MoveBlocks'], `stored ${JSON.stringify(ops)}`)
  assert.equal(ops.find((op) => op.type === 'MoveBlocks')!.blocks.length, 1)
  assert.equal(ops.find((op) => op.type === 'DeleteBlocks')!.blocks.length, 4)
  // What is read back is exactly what was written: nothing lost, and nothing out of order.
  const now = await readMarkdown(address)
  assert.equal(now, without)
  markdown = now
})

await step('inserting a block after the first block of a level keeps the order', async () => {
  const anchor = markdown.indexOf('## Outlook')
  assert.ok(anchor > 0, markdown)
  // Under the title, right after its first paragraph and before the Outlook section.
  const inserted = `${markdown.slice(0, anchor)}  Costs were flat.\n\n${markdown.slice(anchor)}`
  const result = await write({address, content: inserted, options: {action: 'update'}})
  assert.equal(result.unchanged, undefined, JSON.stringify(result))
  const ops = await storedOps(result.version)
  const replaces = ops.filter((op) => op.type === 'ReplaceBlock')
  assert.equal(replaces.length, 1, `stored ${JSON.stringify(ops)}`)
  assert.equal(replaces[0]!.block.text, 'Costs were flat.')
  const moves = ops.filter((op) => op.type === 'MoveBlocks')
  assert.deepEqual(
    moves.map((op) => op.blocks),
    [[replaces[0]!.block.id]],
    `stored ${JSON.stringify(ops)}`,
  )
  const now = await readMarkdown(address)
  const order = ['Revenue grew in every region.', 'Costs were flat.', '## Outlook'].map((text) => now.indexOf(text))
  assert.ok(order[0]! > 0 && order[0]! < order[1]! && order[1]! < order[2]!, now)
  markdown = now
})

await step('a metadata map keeps its unchanged entries and loses the removed one', async () => {
  // `source` was {type: manual, owner: finance}. Writing {type: manual, reviewed: true} must leave
  // `type`, add `reviewed` and drop `owner`.
  const result = await write({
    address,
    options: {action: 'update', metadata: {source: {type: 'manual', reviewed: true}}},
  })
  assert.equal(result.unchanged, undefined, JSON.stringify(result))
  const doc = await document('/report')
  assert.deepEqual(doc.metadata.source, {type: 'manual', reviewed: true})
  assert.equal(doc.metadata.name, 'Quarterly report')
  const attrs = (await storedOps(result.version)).flatMap((op) => op.attrs as {key: string[]; value: unknown}[])
  assert.deepEqual(attrs.map((attr) => [attr.key.join('.'), attr.value]).sort(), [
    ['source.owner', null],
    ['source.reviewed', true],
  ])
  // The same map again changes nothing.
  const again = await write({
    address,
    options: {action: 'update', metadata: {source: {type: 'manual', reviewed: true}}},
  })
  assert.equal(again.unchanged, true, JSON.stringify(again))
  assert.equal(again.version, doc.version)
})

await step('a list and a fraction in metadata are stored, once, beside what the site prepared', async () => {
  const result = await write({
    address,
    options: {action: 'update', metadata: {summary: 'Q3, final', tags: ['finance', 'q3'], confidence: 0.75}},
  })
  assert.equal(result.unchanged, undefined, JSON.stringify(result))
  const doc = await document('/report')
  assert.equal(doc.version, result.version)
  assert.equal(doc.metadata.summary, 'Q3, final')
  assert.deepEqual(doc.metadata.tags, ['finance', 'q3'])
  assert.equal(doc.metadata.confidence, 0.75)
  assert.deepEqual(doc.metadata.source, {type: 'manual', reviewed: true})
  // The latest Change holds the two values the site's API cannot carry; the one under it, which
  // the site prepared, holds the summary.
  const top = (await storedOps(result.version)).flatMap((op) => op.attrs as {key: string[]}[])
  assert.deepEqual(top.map((attr) => attr.key.join('.')).sort(), ['confidence', 'tags'])
  const {value} = (await client.request('GetCID', {cid: result.version})) as {value: {deps: unknown[]}}
  assert.equal(value.deps.length, 1)
  const depCid =
    typeof value.deps[0] === 'string' ? value.deps[0] : String((value.deps[0] as {'/': string})['/'] ?? value.deps[0])
  const under = (await storedOps(depCid)).flatMap((op) => op.attrs as {key: string[]; value: unknown}[])
  assert.deepEqual(under, [{key: ['summary'], value: 'Q3, final'}])
  // Unchanged, they are not written again.
  const again = await write({
    address,
    options: {action: 'update', metadata: {tags: ['finance', 'q3'], confidence: 0.75}},
  })
  assert.equal(again.unchanged, true, JSON.stringify(again))
  assert.equal(again.version, doc.version)
})

fs.rmSync(stateDir, {recursive: true, force: true})
process.exit(failed ? 1 : 0)
