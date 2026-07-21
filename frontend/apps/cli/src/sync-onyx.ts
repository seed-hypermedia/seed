/**
 * sync-onyx.ts — publish the Onyx schema system to Seed Hypermedia.
 *
 * Publishes, under the onyx account (signing key `main`):
 *   1. Every schema blob (schemas/*.json except schemas.lock.json) encoded to
 *      canonical DAG-CBOR and content-addressed. Each computed CID is verified
 *      against schemas/schemas.lock.json; a mismatch fails the run.
 *   2. One Hypermedia document per schema, from its CO-LOCATED markdown
 *      (schemas/<name>.md beside schemas/<name>.json), published at its public
 *      name (onyx- primitives stripped: /map, /string; others prefixed). A TYPE
 *      doc DEFINES a schema (metadata.schemaDefinition = ipfs://<CID>); an
 *      INSTANCE doc ({$type,value}) CONFORMS to one (metadata.schema = $type).
 *   3. Narrative pages from schemas/site/*.md (home.md -> root path "").
 *
 * Usage:
 *   cd frontend/apps/cli && bun run src/sync-onyx.ts [--dry-run] [--server <url>]
 *
 * The markdown importer is lossy (hard-wrapped paragraphs split into blocks,
 * GFM tables become code blocks). Each file is pre-processed first — see
 * prepMarkdown() below, a port of scratchpad/prep.py.
 */

import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as dagCbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {
  createSeedClient,
  createChangeOps,
  createChange,
  createVersionRef,
  markdownBlockNodesToHMBlockNodes,
  parseMarkdown,
  flattenToOperations,
  type DocumentOperation,
} from '@seed-hypermedia/client'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {resolveFileLinks} from './utils/file-links'
import {hmBlockNodeToBlockNode} from './utils/block-diff'
import {resolveKey} from './utils/keyring'
import {createSignerFromKey} from './utils/signer'

// ── Paths ─────────────────────────────────────────────────────────────────────

const DIR = dirname(fileURLToPath(import.meta.url)) // frontend/apps/cli/src
const REPO_ROOT = resolve(DIR, '../../../..') // /Users/ericvicenti/Code/Seed
const SCHEMAS_DIR = resolve(REPO_ROOT, 'schemas')
const SITE_DIR = resolve(SCHEMAS_DIR, 'site')
const LOCK_PATH = resolve(SCHEMAS_DIR, 'schemas.lock.json')

// Every schema is published under the onyx account. Its public name (and the
// path it's published at) strips `onyx-` from primitives/meta and keeps the
// hypermedia-/example- prefix (matches schemas/publish.mjs + the engine).
const ONYX = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

/** The published public name of a schema basename (also its document path). */
function publicName(basename: string): string {
  return basename.startsWith('onyx-') ? basename.slice(5) : basename
}

/** Map a schema basename to its lockfile hm:// URL (the onyx-account doc URL). */
function basenameToLockUrl(basename: string): string {
  return `hm://${ONYX}/${publicName(basename)}`
}

// ── Markdown pre-processor (port of scratchpad/prep.py) ────────────────────────

const LIST_RE = /^\s*([-*+]|\d+[.)])\s+/

/** Align a run of GFM table rows into padded monospace columns. */
function alignTable(rows: string[]): string[] {
  const cells = rows.map((r) =>
    r
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim()),
  )
  const ncol = Math.max(...cells.map((r) => r.length))
  for (const r of cells) while (r.length < ncol) r.push('')

  const isSep = (r: string[]) =>
    r.some((c) => c.includes('-')) && r.every((c) => c === '' || (/-/.test(c) && /^[-:\s]*$/.test(c)))

  const widths = new Array(ncol).fill(0)
  for (const r of cells) {
    if (isSep(r)) continue
    r.forEach((c, i) => {
      widths[i] = Math.max(widths[i], c.length)
    })
  }

  return cells.map((r) => {
    if (isSep(r)) return '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |'
    return '| ' + r.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |'
  })
}

/** Prepare Onyx markdown for the (lossy) Seed markdown importer. */
function prepMarkdown(text: string): string {
  const lines = text.split('\n')
  const n = lines.length
  let i = 0
  const out: string[] = []

  // frontmatter passthrough
  if (lines.length && lines[0].trim() === '---') {
    out.push(lines[0])
    i = 1
    while (i < n && lines[i].trim() !== '---') {
      out.push(lines[i])
      i++
    }
    if (i < n) {
      out.push(lines[i])
      i++
    }
  }

  while (i < n) {
    const line = lines[i]
    const s = line.trim()

    // blank
    if (s === '') {
      out.push('')
      i++
      continue
    }

    // fenced code block: passthrough until closing fence
    if (s.startsWith('```') || s.startsWith('~~~')) {
      const fence = s.slice(0, 3)
      out.push(line)
      i++
      while (i < n && lines[i].trim().slice(0, 3) !== fence) {
        out.push(lines[i])
        i++
      }
      if (i < n) {
        out.push(lines[i])
        i++
      }
      continue
    }

    // heading passthrough
    if (s.startsWith('#')) {
      out.push(s)
      i++
      continue
    }

    // table: current line has '|' and the next line is a separator row
    if (line.includes('|') && i + 1 < n && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows: string[] = []
      while (i < n && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(lines[i])
        i++
      }
      out.push(...alignTable(rows))
      continue
    }

    // list item: keep marker, unwrap continuation lines onto one line
    if (LIST_RE.test(line)) {
      let buf = s
      i++
      while (i < n) {
        const nxt = lines[i]
        const t = nxt.trim()
        if (
          t === '' ||
          t.startsWith('#') ||
          LIST_RE.test(nxt) ||
          t.startsWith('```') ||
          (nxt.includes('|') && t.startsWith('|'))
        ) {
          break
        }
        buf += ' ' + t
        i++
      }
      out.push(buf)
      continue
    }

    // plain paragraph: unwrap onto a single line
    let buf = s
    i++
    while (i < n) {
      const nxt = lines[i]
      const t = nxt.trim()
      if (t === '' || t.startsWith('#') || LIST_RE.test(nxt) || t.startsWith('```') || nxt.includes('|')) {
        break
      }
      buf += ' ' + t
      i++
    }
    out.push(buf)
  }

  return out.join('\n') + '\n'
}

// ── Ops helpers ────────────────────────────────────────────────────────────────

/**
 * Build a SetAttributes op from a metadata map. Unlike the CLI's mergeMetadata,
 * this emits EVERY key (including schemaDefinition and other unknown keys).
 */
function metadataToSetAttributes(metadata: Record<string, unknown>): DocumentOperation | null {
  const attrs: Array<{key: string[]; value: unknown}> = []
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) attrs.push({key: [key], value})
  }
  if (attrs.length === 0) return null
  return {type: 'SetAttributes', attrs}
}

/** Parse markdown into content ops (mirrors document.ts readInput markdown path). */
async function markdownToOps(content: string): Promise<{ops: DocumentOperation[]; metadata: HMMetadata}> {
  const {tree, metadata} = parseMarkdown(content)
  const hmNodes = markdownBlockNodesToHMBlockNodes(tree)
  const resolved = await resolveFileLinks(hmNodes)
  const resolvedTree = resolved.nodes.map(hmBlockNodeToBlockNode)
  const ops = flattenToOperations(resolvedTree)
  return {ops, metadata}
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const serverIdx = args.indexOf('--server')
  const serverUrl = serverIdx >= 0 ? args[serverIdx + 1] : 'https://hyper.media'

  // Resolve signing key / account
  const key = resolveKey('main', false)
  const account = key.accountId
  const signer = createSignerFromKey(key)
  console.log(`Account: ${account}`)
  console.log(`Server:  ${serverUrl}`)
  console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'PUBLISH'}`)
  console.log('')

  // ── 1. Schema blobs ──
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as {schemas: Record<string, string>}
  const schemaFiles = readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'schemas.lock.json')
    .sort()

  const schemaBlobs: Array<{data: Uint8Array; cid: string}> = []
  const schemaCidByBasename = new Map<string, string>()
  // Instance files are VALUES, not schemas ({$type, value}) — their document
  // CONFORMS to a schema (metadata.schema = $type), it does not DEFINE one.
  const instanceTypeByBasename = new Map<string, string>()
  let mismatches = 0

  for (const file of schemaFiles) {
    const basename = file.replace(/\.json$/, '')
    const obj = JSON.parse(readFileSync(resolve(SCHEMAS_DIR, file), 'utf8'))
    if (obj && typeof obj === 'object' && typeof obj.$type === 'string' && 'value' in obj) {
      instanceTypeByBasename.set(basename, obj.$type)
    }
    const data = dagCbor.encode(obj)
    const hash = await sha256.digest(data)
    const cid = CID.create(1, dagCbor.code, hash).toString()

    const lockUrl = basenameToLockUrl(basename)
    const expected = lock.schemas[lockUrl]
    if (!expected) {
      console.error(`  ! ${file}: no lockfile entry for ${lockUrl}`)
      mismatches++
    } else if (expected !== cid) {
      console.error(`  ! ${file}: CID mismatch\n      computed ${cid}\n      lockfile ${expected}`)
      mismatches++
    }
    schemaBlobs.push({data: new Uint8Array(data), cid})
    schemaCidByBasename.set(basename, cid)
  }

  if (mismatches > 0) {
    console.error(`\nFAILED: ${mismatches} schema CID mismatch(es). Aborting.`)
    process.exit(1)
  }
  console.log(`Schema blobs: ${schemaBlobs.length} encoded, all CIDs match the lockfile.`)

  // ── 2. Documents ──
  type DocPlan = {
    dir: string
    file: string
    path: string
    isSchemaDoc: boolean
    /** Set on a TYPE doc: the schema this document DEFINES (ipfs://<cid>). */
    schemaDefinition?: string
    /** Set on an INSTANCE doc: the schema this document CONFORMS to (its $type). */
    schema?: string
  }

  // 2a. Schema docs: the co-located schemas/<name>.md beside each schema. Each is
  // published at hm://<onyx>/<name> with schemaDefinition = ipfs://<schema CID>,
  // so the document IS the referenceable schema (others point `schema` here).
  const missingDocs: string[] = []
  const schemaPlans: DocPlan[] = [...schemaCidByBasename.keys()].sort().map((basename) => {
    const file = `${basename}.md`
    if (!existsSync(resolve(SCHEMAS_DIR, file))) missingDocs.push(file)
    const instanceType = instanceTypeByBasename.get(basename)
    return {
      dir: SCHEMAS_DIR,
      file,
      path: `/${publicName(basename)}`,
      isSchemaDoc: true,
      // A value conforms to its type (schema); a type defines one (schemaDefinition).
      ...(instanceType ? {schema: instanceType} : {schemaDefinition: `ipfs://${schemaCidByBasename.get(basename)}`}),
    }
  })
  if (missingDocs.length) {
    throw new Error(
      `Missing co-located schema docs (run \`node scripts/gen-onyx-site.mjs\` to scaffold): ${missingDocs.join(', ')}`,
    )
  }

  // 2b. Narrative pages + home: schemas/site/*.md (no schemaDefinition).
  const narrativePlans: DocPlan[] = readdirSync(SITE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const basename = file.replace(/\.md$/, '')
      return {dir: SITE_DIR, file, path: basename === 'home' ? '' : `/${basename}`, isSchemaDoc: false}
    })

  const plans: DocPlan[] = [...schemaPlans, ...narrativePlans]

  console.log(`Documents: ${plans.length} (${schemaPlans.length} schema docs + ${narrativePlans.length} narrative)`)
  console.log('')

  // ── Dry run: report and exit ──
  if (dryRun) {
    for (const p of plans) {
      const label = p.path === '' ? '(home root "")' : p.path
      if (p.schema) {
        console.log(`  ${label}  ->  schema=${p.schema}  (instance)`)
      } else if (p.schemaDefinition) {
        console.log(`  ${label}  ->  schemaDefinition=${p.schemaDefinition}`)
      } else {
        console.log(`  ${label}`)
      }
    }
    console.log(`\nDRY RUN complete: ${schemaBlobs.length} schema blobs + ${plans.length} docs would publish.`)
    return
  }

  // ── Real run ──
  const client = createSeedClient(serverUrl)

  // Publish all schema blobs up front so their CIDs are fetchable.
  console.log(`Publishing ${schemaBlobs.length} schema blobs...`)
  await client.publish({blobs: schemaBlobs})
  console.log('  done.\n')

  let published = 0
  for (const p of plans) {
    const raw = readFileSync(resolve(p.dir, p.file), 'utf8')
    const prepped = prepMarkdown(raw)
    const {ops: contentOps, metadata} = await markdownToOps(prepped)

    // Merge frontmatter metadata + inject the schema binding: a TYPE doc DEFINES
    // a schema (schemaDefinition); an INSTANCE doc CONFORMS to one (schema).
    const mergedMeta: Record<string, unknown> = {...metadata}
    if (p.schemaDefinition) mergedMeta.schemaDefinition = p.schemaDefinition
    if (p.schema) mergedMeta.schema = p.schema

    const ops: DocumentOperation[] = []
    const metaOp = metadataToSetAttributes(mergedMeta)
    if (metaOp) ops.push(metaOp)
    ops.push(...contentOps)

    const {unsignedBytes, ts} = createChangeOps({ops})
    const changeBlock = await createChange(unsignedBytes, signer)
    const refInput = await createVersionRef(
      {
        space: account,
        path: p.path,
        genesis: changeBlock.cid.toString(),
        version: changeBlock.cid.toString(),
        generation: Number(ts),
        capability: undefined,
      },
      signer,
    )

    await client.publish({
      blobs: [{data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()}, ...refInput.blobs],
    })

    published++
    const label = p.path === '' ? '(home root)' : p.path
    const tag = p.schemaDefinition ? `  [schemaDefinition ${p.schemaDefinition}]` : ''
    console.log(`  [${published}/${plans.length}] ${label}${tag}`)
  }

  console.log(`\nDONE: published ${schemaBlobs.length} schema blobs + ${published} documents.`)
  console.log(`Root: hm://${account}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
