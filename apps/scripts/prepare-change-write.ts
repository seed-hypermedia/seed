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
import {
  createTreeFuzzer,
  flatTree,
  newFuzzStats,
  recordFuzzRound,
  treeShape,
  type Tree,
} from '../../tests/integration/tree-fuzz'
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

/**
 * Why the service built the last Change itself instead of using the site's, when it did. The
 * service says so in a warning; nothing in the write's result tells the two apart.
 */
let builtHere: string | undefined
const warn = console.warn
console.warn = (...args: unknown[]) => {
  const why = (args[1] as {why?: unknown} | undefined)?.why
  if (String(args[0]).includes('Building the document change here') && typeof why === 'string') builtHere = why
  else warn(...args)
}

const write = (input: Record<string, unknown>) => {
  builtHere = undefined
  return apisvc.executeWriteVerb(context, input) as Promise<Record<string, any>>
}

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

await step('removing a section deletes its blocks and moves nothing', async () => {
  const start = markdown.indexOf('## Regions')
  const end = markdown.indexOf('## Outlook')
  assert.ok(start > 0 && end > start, markdown)
  const without = markdown.slice(0, start) + markdown.slice(end)
  const result = await write({address, content: without, options: {action: 'update'}})
  assert.equal(result.unchanged, undefined, JSON.stringify(result))
  const ops = await storedOps(result.version)
  // The section's blocks are deleted. The blocks around it stay in the order they had, so no
  // block is moved and none is rewritten.
  assert.deepEqual(
    ops.map((op) => op.type),
    ['DeleteBlocks'],
    `stored ${JSON.stringify(ops)}`,
  )
  assert.equal(ops[0]!.blocks.length, 4)
  // What is read back is exactly what was written: nothing lost, and nothing out of order.
  const now = await readMarkdown(address)
  assert.equal(now, without)
  markdown = now
})

await step('inserting a block after the first block of a level keeps the order', async () => {
  const anchor = markdown.indexOf('## Outlook')
  assert.ok(anchor > 0, markdown)
  // Under the title, right after its first paragraph and before the Outlook section.
  const inserted = `${markdown.slice(0, anchor)}Costs were flat.\n\n${markdown.slice(anchor)}`
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

// ── Reordering ──────────────────────────────────────────────────────────────
// A flat document of one-line paragraphs, rewritten in a new order with the block ids the read
// gave. What matters is the order read back: the site drops moves it should keep when a level is
// sent as a diff lists it, so the service sends the fewest moves, or builds the change itself.

/** The paragraphs of a flat document as the agent reads them: markdown chunks carrying block ids. */
async function readChunks(docAddress: string): Promise<Map<string, string>> {
  const chunks = new Map<string, string>()
  for (const chunk of (await readMarkdown(docAddress)).split(/\n{2,}/)) {
    const text = chunk.replace(/<!--[\s\S]*?-->/g, '').trim()
    if (text) chunks.set(text, chunk.trim())
  }
  return chunks
}

async function rootTexts(docPath: string): Promise<string[]> {
  return ((await document(docPath)).content ?? []).map((node) => (node.block as {text?: string}).text ?? '')
}

/** Rewrites the document as `texts`, in that order: known paragraphs keep their ids, others are new. */
async function writeOrder(docPath: string, texts: string[]) {
  const docAddress = `hm://${account}${docPath}`
  const chunks = await readChunks(docAddress)
  const content = texts.map((text) => chunks.get(text) ?? text).join('\n\n') + '\n'
  const result = await write({address: docAddress, content, options: {action: 'update'}})
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  const got = await rootTexts(docPath)
  assert.deepEqual(got, texts, `wrote ${JSON.stringify(texts)}, read back ${JSON.stringify(got)}`)
  return result
}

async function createFlat(docPath: string, texts: string[]) {
  const result = await write({
    address: `hm://${account}${docPath}`,
    content: texts.join('\n\n') + '\n',
    options: {name: docPath.slice(1)},
  })
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  assert.deepEqual(await rootTexts(docPath), texts)
}

await step('moving a block to the end, past blocks that stay, keeps the order', async () => {
  await createFlat('/order-end', ['alpha', 'bravo', 'charlie', 'delta'])
  const result = await writeOrder('/order-end', ['alpha', 'charlie', 'delta', 'bravo'])
  // One block moved, and the site stored exactly that.
  const ops = await storedOps(result.version)
  assert.equal(ops.length, 1, `stored ${JSON.stringify(ops)}`)
  assert.equal(ops[0]!.type, 'MoveBlocks')
  assert.equal(ops[0]!.blocks.length, 1)
})

await step('moving two neighbouring blocks together keeps the order', async () => {
  await createFlat('/order-together', ['alpha', 'bravo', 'charlie', 'delta'])
  // The site cannot be asked for this one; the service builds the change, stored as listed.
  const result = await writeOrder('/order-together', ['charlie', 'delta', 'alpha', 'bravo'])
  const moves = (await storedOps(result.version)).filter((op) => op.type === 'MoveBlocks')
  assert.equal(moves.length, 1, `stored ${JSON.stringify(moves)}`)
  assert.equal(moves[0]!.blocks.length, 4)
})

// ── New parents ─────────────────────────────────────────────────────────────

/** The document's block texts as a nested list: `['A', ['B', ['C']]]` is `A`, then `B` with child `C`. */
const texts = (nodes: any[] | undefined): unknown[] =>
  (nodes ?? []).map((node) => {
    const text = node.block.text ?? `<${node.block.type}>`
    return node.children?.length ? [text, texts(node.children)] : text
  })

await step('two new sections, a nested list with two parents and a new table arrive in one update', async () => {
  // Every one of these is a new block with children. The site refused such an update ("desired
  // parent block is not in the tree") when a move came before the content of a new parent.
  const docAddress = `hm://${account}/parents`
  const created = await write({address: docAddress, content: 'Intro\n\nOutro\n', options: {name: 'Parents'}})
  assert.equal(created.type, 'hypermedia_write_result', JSON.stringify(created))
  const before = await readMarkdown(docAddress)
  const added = `${before.trimEnd()}

# Section one

First of one

Second of one

| Name | Value |
| --- | --- |
| alpha | 1 |

# Section two

- Parent A
  - Child a1
  - Child a2
- Parent B
  - Child b1
`
  const result = await write({address: docAddress, content: added, options: {action: 'update'}})
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  assert.equal(result.unchanged, undefined)
  assert.equal(builtHere, undefined, `the site should have prepared this: ${builtHere}`)
  const doc = await document('/parents')
  const tree = JSON.stringify(texts(doc.content))
  assert.ok(tree.includes('["Section one",["First of one","Second of one",'), tree)
  assert.ok(tree.includes(JSON.stringify(['Parent A', ['Child a1', 'Child a2']])), tree)
  assert.ok(tree.includes(JSON.stringify(['Parent B', ['Child b1']])), tree)
  for (const cell of ['Name', 'Value', 'alpha', '1']) assert.ok(tree.includes(JSON.stringify(cell)), tree)
  // The two blocks that were there are not written or moved again.
  const ops = await storedOps(result.version)
  const touched = JSON.stringify(ops)
  for (const node of (await document('/parents')).content!.slice(0, 2)) {
    assert.ok(!touched.includes(`"${node.block.id}"`), `block ${node.block.id} was written again: ${touched}`)
  }
  // And what the agent reads back, written again, changes nothing.
  const again = await write({address: docAddress, content: await readMarkdown(docAddress), options: {action: 'update'}})
  assert.equal(
    again.unchanged,
    true,
    again.unchanged ? '' : `the rewrite stored ${JSON.stringify(await storedOps(again.version))}`,
  )
})

// ── Clocks ──────────────────────────────────────────────────────────────────
// A Change the site prepares carries the site's clock; one the service builds carries its own.

await step('with the service clock behind the site, Changes built here still follow the ones under them', async () => {
  const docAddress = `hm://${account}/clock-behind`
  await write({address: docAddress, content: 'One\n\nTwo\n', options: {name: 'Clock behind'}})
  // A prepared Change first, so the head carries the site's clock.
  const prepared = await write({address: docAddress, options: {action: 'update', metadata: {summary: 'Prepared'}}})
  assert.equal(builtHere, undefined)
  apisvc.setDocumentUpdateClockForTests(() => Date.now() - 5_000)
  try {
    // Only values the site cannot carry: one Change, built here on that head.
    const verbatim = await write({address: docAddress, options: {action: 'update', metadata: {tags: ['a', 'b']}}})
    assert.equal(verbatim.unchanged, undefined, JSON.stringify(verbatim))
    const head = (await client.request('GetCID', {cid: prepared.version})) as {value: {ts: number}}
    const built = (await client.request('GetCID', {cid: verbatim.version})) as {value: {ts: number}}
    assert.equal(Number(built.value.ts), Number(head.value.ts) + 1)
    assert.deepEqual((await document('/clock-behind')).metadata.tags, ['a', 'b'])
    // A prepared part and such values together: two Changes, the second after the first.
    const both = await write({
      address: docAddress,
      options: {action: 'update', metadata: {summary: 'Both', tags: ['a', 'b', 'c']}},
    })
    const top = (await client.request('GetCID', {cid: both.version})) as {value: {ts: number; deps: any[]}}
    const depCid = typeof top.value.deps[0] === 'string' ? top.value.deps[0] : String(top.value.deps[0]['/'])
    const under = (await client.request('GetCID', {cid: depCid})) as {value: {ts: number}}
    assert.equal(Number(top.value.ts), Number(under.value.ts) + 1)
    // Ops the site cannot be asked for (neighbours moving together), built here.
    await createFlat('/clock-behind-order', ['alpha', 'bravo', 'charlie', 'delta'])
    await writeOrder('/clock-behind-order', ['alpha', 'bravo', 'charlie', 'delta', 'echo'])
    assert.equal(builtHere, undefined)
    await writeOrder('/clock-behind-order', ['charlie', 'delta', 'echo', 'alpha', 'bravo'])
    assert.match(builtHere ?? '', /moves together/)
  } finally {
    apisvc.setDocumentUpdateClockForTests(undefined)
  }
  // The documents still read, and take a further update the site prepares.
  const doc = await document('/clock-behind')
  assert.equal(doc.metadata.summary, 'Both')
  assert.deepEqual(doc.metadata.tags, ['a', 'b', 'c'])
  const further = await write({address: docAddress, options: {action: 'update', metadata: {summary: 'After'}}})
  assert.equal(further.unchanged, undefined, JSON.stringify(further))
  assert.equal(builtHere, undefined)
  assert.equal((await document('/clock-behind')).metadata.summary, 'After')
  await writeOrder('/clock-behind-order', ['charlie', 'delta', 'echo', 'alpha', 'bravo', 'foxtrot'])
})

await step(
  'with the service clock ahead of the site, the site still prepares the next update after the head',
  async () => {
    const docAddress = `hm://${account}/clock-ahead`
    await write({address: docAddress, content: 'One\n\nTwo\n', options: {name: 'Clock ahead'}})
    // Twenty seconds ahead: under the forty the daemon tolerates in a Change it is given.
    apisvc.setDocumentUpdateClockForTests(() => Date.now() + 20_000)
    let ahead: Record<string, any>
    try {
      ahead = await write({address: docAddress, options: {action: 'update', metadata: {tags: ['x']}}})
      assert.equal(ahead.unchanged, undefined, JSON.stringify(ahead))
    } finally {
      apisvc.setDocumentUpdateClockForTests(undefined)
    }
    // The head is now later than the site's clock. The site stamps the next Change by the
    // document's causal clock, one millisecond after the head, so it still prepares it.
    const next = await write({address: docAddress, options: {action: 'update', metadata: {summary: 'Next'}}})
    assert.equal(next.unchanged, undefined, JSON.stringify(next))
    assert.equal(builtHere, undefined)
    const head = (await client.request('GetCID', {cid: ahead.version})) as {value: {ts: number}}
    const built = (await client.request('GetCID', {cid: next.version})) as {value: {ts: number}}
    assert.equal(Number(built.value.ts), Number(head.value.ts) + 1)
    const doc = await document('/clock-ahead')
    assert.equal(doc.version, next.version)
    assert.equal(doc.metadata.summary, 'Next')
    assert.deepEqual(doc.metadata.tags, ['x'])
    const further = await write({address: docAddress, content: 'One\n\nTwo\n\nThree\n', options: {action: 'update'}})
    assert.equal(further.type, 'hypermedia_write_result', JSON.stringify(further))
    assert.equal(((await document('/clock-ahead')).content ?? []).length, 3)
  },
)

// ── Random edits ────────────────────────────────────────────────────────────

/** The document's block ids as a nested list. */
const idShape = (nodes: any[] | undefined): unknown[] =>
  (nodes ?? []).map((node) => (node.children?.length ? [node.block.id, idShape(node.children)] : node.block.id))

/** A tree as the markdown an agent writes: one paragraph per block, its id in a comment, children indented. */
const treeMarkdown = (tree: Tree, indent = ''): string =>
  tree
    .map((node) => {
      const own = `${indent}Text ${node.id} <!-- id:${node.id} -->`
      return node.children.length ? `${own}\n\n${treeMarkdown(node.children, `${indent}  `)}` : own
    })
    .join('\n\n')

await step('seeded random edits of a nested document all read back as written', async () => {
  // One document per seed, walked through rounds of one to four edits: blocks and whole subtrees
  // inserted, deleted and moved, indents and outdents. No round leaves a parent/child inversion
  // in the document's history: a daemon without Seed PR #1375 never answers a request that moves
  // blocks in a document with one, and the daemon binary under plz-out/ may be that old (CI
  // builds the daemon from the branch). Each document ends with one swap of a parent and its
  // child, which is built here and never sent, and is not written to again.
  const stats = newFuzzStats()
  const failures: string[] = []
  for (const seed of [20261116, 424242, 31337]) {
    const fuzzer = createTreeFuzzer(seed, {inversions: false})
    const docPath = `/random-${seed}`
    const docAddress = `hm://${account}${docPath}`
    let tree: Tree = flatTree('a', 'b', 'c', 'd', 'e')
    tree[1]!.children = flatTree('p', 'q', 'r')
    const created = await write({address: docAddress, content: `${treeMarkdown(tree)}\n`, options: {name: 'Random'}})
    assert.equal(created.type, 'hypermedia_write_result', JSON.stringify(created))
    assert.deepEqual(idShape((await document(docPath)).content), treeShape(tree))
    for (let round = 0; round <= 30; round++) {
      const next = round < 30 ? fuzzer.mutate(tree) : fuzzer.swap(tree)
      if (!next) throw new Error(`seed ${seed}: no parent to swap in ${JSON.stringify(treeShape(tree))}`)
      const label = `seed ${seed} round ${round} (${next.edits.join(', ')}): ${JSON.stringify(
        treeShape(tree),
      )} -> ${JSON.stringify(treeShape(next.tree))}`
      let result: Record<string, any>
      try {
        result = await write({
          address: docAddress,
          content: `${treeMarkdown(next.tree)}\n`,
          options: {action: 'update'},
        })
      } catch (error) {
        failures.push(`${label}: ${(error as Error).message}`)
        break
      }
      if (result.type !== 'hypermedia_write_result') {
        failures.push(`${label}: ${JSON.stringify(result)}`)
        break
      }
      const got = idShape((await document(docPath)).content)
      const right = JSON.stringify(got) === JSON.stringify(treeShape(next.tree))
      recordFuzzRound(stats, {
        builtBy: result.unchanged ? undefined : builtHere ? 'local' : 'server',
        localReason: builtHere,
        edits: next.edits,
        right,
      })
      if (!right) failures.push(`${label}: read back ${JSON.stringify(got)}`)
      tree = next.tree
    }
  }
  console.log(JSON.stringify({stats}))
  assert.deepEqual(failures, [])
  assert.equal(stats.rounds, 93)
  assert.equal(stats.wrong, 0)
  assert.equal(stats.edits.swap, 3)
  // No round waited for a site that was never going to answer.
  assert.deepEqual(
    Object.keys(stats.reasons).filter((reason) => reason.includes('did not answer')),
    [],
  )
  assert.ok(stats.server > 5, `only ${stats.server} of ${stats.rounds} changes were prepared by the site`)
})

// ── Reading a document and writing it back, edits by block id, and what a body leaves out ───────

const richAddress = `hm://${account}/rich`
const block = (block: Record<string, unknown>, children: unknown[] = []) => ({
  block: {text: '', annotations: [], attributes: {}, ...block},
  children,
})
const para = (id: string, text: string, attributes: Record<string, unknown> = {}, children: unknown[] = []) =>
  block({type: 'Paragraph', id, text, attributes}, children)
/** Every kind of block the read used to change on the way back. */
const RICH = [
  block({type: 'Heading', id: 'richhead', text: 'Rich', attributes: {childrenType: 'Group'}}, [
    para('multiline', 'first line\nsecond line\nthird line'),
    block({
      type: 'Paragraph',
      id: 'tworanges',
      text: 'one two three',
      annotations: [{type: 'Bold', starts: [0, 8], ends: [3, 13]}],
    }),
    block({
      type: 'Paragraph',
      id: 'mentions',
      text: 'see ￼',
      annotations: [{type: 'Embed', starts: [4], ends: [5], link: address}],
    }),
    para('listhold', '', {childrenType: 'Unordered'}, [
      para('listone', 'an item', {childrenType: 'Group'}, [
        block({type: 'Code', id: 'codeblok', text: 'if (a) {\n  b()\n}', attributes: {language: 'ts'}}),
        block({type: 'Math', id: 'mathblok', text: 'x = 1\n  y = 2'}),
      ]),
      para('listtwo', 'another item'),
    ]),
    para('afterlst', 'a paragraph after the list'),
    block({type: 'Embed', id: 'embedblk', link: address, attributes: {view: 'Card'}}),
    block({
      type: 'Query',
      id: 'queryblk',
      attributes: {style: 'List', query: {includes: [{space: account, path: '', mode: 'Children'}]}},
    }),
    block({type: 'Button', id: 'buttonbk', link: address, text: 'Open the report', attributes: {alignment: 'center'}}),
  ]),
  para('richtail', 'the end'),
]
const ZERO = {added: 0, rewritten: 0, moved: 0, deleted: 0}
let rich = ''

const blockIds = (doc: {content?: unknown[]}) => {
  const ids: string[] = []
  const visit = (nodes: any[]) =>
    nodes.forEach((node) => {
      ids.push(node.block.id)
      visit(node.children ?? [])
    })
  visit((doc.content ?? []) as any[])
  return ids
}

/** A refused write: the message, whether it was thrown or returned. */
async function refusal(input: Record<string, unknown>): Promise<string> {
  try {
    const result = await write(input)
    assert.notEqual(result.type, 'hypermedia_write_result', `the write was not refused: ${JSON.stringify(result)}`)
    return String(result.message ?? JSON.stringify(result))
  } catch (error) {
    return (error as Error).message
  }
}

await step('a document of every block kind writes back as nothing, exactly as read', async () => {
  const made = await write({address: richAddress, options: {name: 'Rich', input: {content: RICH, format: 'json'}}})
  assert.equal(made.type, 'hypermedia_write_result', JSON.stringify(made))
  const before = await document('/rich')
  rich = await readMarkdown(richAddress)
  // What the embed and the query point at is shown, and marked as not part of the document.
  assert.match(rich, /<!-- resolved: Quarterly report -->[\s\S]*Revenue grew[\s\S]*<!-- \/resolved -->/)
  assert.match(rich, /<!-- resolved: query results -->/)
  assert.match(rich, /type:Query attrs:/)
  const result = await write({address: richAddress, content: rich, options: {action: 'update'}})
  assert.equal(result.unchanged, true, JSON.stringify(result))
  assert.deepEqual(result.changes, ZERO)
  assert.equal((await document('/rich')).version, before.version)
})

await step('a body that lost its id comments keeps the ids of the blocks with text', async () => {
  const before = await document('/rich')
  const stripped = rich.replace(/ ?<!-- id:[A-Za-z0-9_-]+ -->/g, '')
  assert.notEqual(stripped, rich)
  const result = await write({address: richAddress, content: stripped, options: {action: 'update'}, dryRun: true})
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  // Markdown without ids nests the list under the paragraph before it. So that paragraph is
  // rewritten, and the list's own holder, a block with no text, goes. No block with text is made new.
  assert.equal(result.changes.added, 0, JSON.stringify(result.changes))
  assert.equal(result.changes.deleted, 1, JSON.stringify(result.changes))
  assert.equal(result.changes.rewritten, 1, JSON.stringify(result.changes))
  assert.equal((await document('/rich')).version, before.version)
})

await step('edits change the blocks they name and nothing else', async () => {
  const before = await document('/rich')
  const result = await write({
    address: richAddress,
    options: {
      action: 'update',
      edits: [
        {replace: 'afterlst', content: 'a paragraph after the list, edited'},
        {after: 'listtwo', content: '- a third item'},
        {delete: 'tworanges'},
        {move: 'richtail', before: 'richhead'},
      ],
    },
  })
  assert.equal(result.type, 'hypermedia_write_result', JSON.stringify(result))
  assert.deepEqual(result.changes, {added: 1, rewritten: 1, moved: 1, deleted: 1})
  const ops = await storedOps(result.version)
  const replaced = ops.filter((op) => op.type === 'ReplaceBlock').map((op) => op.block.text)
  assert.deepEqual(replaced.sort(), ['a paragraph after the list, edited', 'a third item'])
  assert.deepEqual(
    ops.filter((op) => op.type === 'DeleteBlocks' || op.type === 'DeleteBlock').length,
    1,
    JSON.stringify(ops),
  )
  const after = await document('/rich')
  const kept = blockIds(before).filter((id) => id !== 'tworanges')
  assert.deepEqual(
    blockIds(after)
      .filter((id) => kept.includes(id))
      .sort(),
    kept.sort(),
    'a block no edit named lost its id',
  )
  assert.equal(blockIds(after)[0], 'richtail')
  rich = await readMarkdown(richAddress)
  const again = await write({address: richAddress, content: rich, options: {action: 'update'}})
  assert.equal(again.unchanged, true, JSON.stringify(again))
})

await step('an edit that cannot apply publishes nothing', async () => {
  const before = await document('/rich')
  const message = await refusal({
    address: richAddress,
    options: {action: 'update', edits: [{delete: 'listone'}, {replace: 'nosuchid', content: 'x'}]},
  })
  assert.match(message, /Edit 2: the document has no block with id "nosuchid"/)
  assert.equal((await document('/rich')).version, before.version)
})

await step('a body that leaves out most of the document is refused unless forced', async () => {
  const before = await document('/rich')
  const summary = 'A short summary of the document.\n'
  const message = await refusal({address: richAddress, content: summary, options: {action: 'update'}})
  assert.match(message, /would delete \d+ of the document's \d+ blocks/)
  assert.equal((await document('/rich')).version, before.version)
  const preview = await write({address: richAddress, content: summary, options: {action: 'update'}, dryRun: true})
  assert.match(String(preview.wouldRefuse), /options\.force/)
  assert.equal(preview.changes.deleted, blockIds(before).length)
  const forced = await write({address: richAddress, content: summary, options: {action: 'update', force: true}})
  assert.equal(forced.type, 'hypermedia_write_result', JSON.stringify(forced))
  assert.deepEqual(blockIds(await document('/rich')).length, 1)
})

await step('one page of a long document cannot be its body, and is enough to edit it', async () => {
  const longAddress = `hm://${account}/long`
  const paragraphs = Array.from({length: 400}, (_, i) => `Paragraph ${i} ${'lorem ipsum dolor sit amet '.repeat(4)}`)
  const made = await write({address: longAddress, content: paragraphs.join('\n\n'), options: {name: 'Long'}})
  assert.equal(made.type, 'hypermedia_write_result', JSON.stringify(made))
  const input = {address: longAddress}
  const page = apisvc.paginateReadResult(
    (await apisvc.executeReadVerb(context, input)) as Record<string, unknown>,
    input,
  ) as {markdown: string; page?: {nextOffset?: number}}
  assert.ok(page.page?.nextOffset, 'the read was not paged')
  assert.match(page.markdown, /<!-- page: characters 0-\d+ of \d+; part of the document, not all of it -->\n$/)
  const message = await refusal({address: longAddress, content: page.markdown, options: {action: 'update'}})
  assert.match(message, /part of a document and not a whole body/)
  const id = /Paragraph 3 .*<!-- id:([A-Za-z0-9_-]+) -->/.exec(page.markdown)?.[1]
  assert.ok(id, 'the page carries no block id')
  const result = await write({
    address: longAddress,
    options: {action: 'update', edits: [{replace: id, content: 'Paragraph 3, rewritten from one page.'}]},
  })
  assert.deepEqual(result.changes, {added: 0, rewritten: 1, moved: 0, deleted: 0})
  assert.equal(blockIds(await document('/long')).length, 400)
  assert.equal((await storedOps(result.version)).length, 1)
})

fs.rmSync(stateDir, {recursive: true, force: true})
process.exit(failed ? 1 : 0)
