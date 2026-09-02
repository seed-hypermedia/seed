/**
 * sync-onyx.ts — the Onyx library (hypermedia/) ⇄ its Hypermedia site.
 *
 *   cd frontend/apps/cli
 *   bun run src/sync-onyx.ts push [--dry-run] [--server <url>] [--key <name>]
 *   bun run src/sync-onyx.ts pull [--server <url>] [--space <uid>]
 *
 * push: verify every hypermedia/*.schema.json against schemas.lock.json,
 *       publish the schema blobs, then import hypermedia/ as documents. A
 *       document that already exists is updated by block id on its existing
 *       genesis; unchanged documents are skipped.
 * pull: export every document of the space back into hypermedia/ — markdown
 *       per document, and the schema blob of each type document as its
 *       co-located *.schema.json — then refresh schemas.lock.json and the
 *       bundled schema registry.
 *
 * Layout (hypermedia/):
 *   <basename>.md + <basename>.schema.json  → hm://<space>/<publicName>
 *       publicName strips `onyx-` from primitives/meta (onyx-string → /string)
 *   site/home.md                            → hm://<space>            (root)
 *   site/<name>.md                          → hm://<space>/<name>
 *
 * A TYPE doc DEFINES a schema (metadata.schemaDefinition = ipfs://<CID>); an
 * INSTANCE doc ({$type, value} file) CONFORMS to one (metadata.schema = $type).
 * The markdown is the lossless dialect of @seed-hypermedia/client, so files
 * carry block ids and round-trip through the app unchanged.
 */

import {spawnSync} from 'node:child_process'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {gunzipSync, inflateRawSync, inflateSync} from 'node:zlib'

// Bun (as of 1.2.x) lacks the web DecompressionStream, which the vault reader
// uses to decompress vault.json. Polyfill it with node:zlib.
if (typeof (globalThis as any).DecompressionStream === 'undefined') {
  ;(globalThis as any).DecompressionStream = class {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<Uint8Array>
    constructor(format: 'gzip' | 'deflate' | 'deflate-raw') {
      const chunks: Buffer[] = []
      let finish!: (data: Uint8Array) => void
      const done = new Promise<Uint8Array>((r) => (finish = r))
      this.writable = new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(Buffer.from(chunk))
        },
        close() {
          const buf = Buffer.concat(chunks)
          const out =
            format === 'gzip' ? gunzipSync(buf) : format === 'deflate' ? inflateSync(buf) : inflateRawSync(buf)
          finish(new Uint8Array(out))
        },
      })
      this.readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(await done)
          controller.close()
        },
      })
    }
  }
}
import * as dagCbor from '@ipld/dag-cbor'
import {createSeedClient} from '@seed-hypermedia/client'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {resolveSigningKey} from './utils/keys'
import {createSignerFromKey} from './utils/signer'
import {exportSpace, importSpace, type SpaceLayout} from './utils/space-sync'

// ── Paths ─────────────────────────────────────────────────────────────────────

const DIR = dirname(fileURLToPath(import.meta.url)) // frontend/apps/cli/src
const REPO_ROOT = resolve(DIR, '../../../..')
const SCHEMAS_DIR = resolve(REPO_ROOT, 'hypermedia')
const LOCK_PATH = resolve(SCHEMAS_DIR, 'schemas.lock.json')

// ── Naming ────────────────────────────────────────────────────────────────────

/** The onyx account: the space the library is published under. */
const ONYX = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

/** Public doc name for a schema file basename: strip `onyx-` from primitives/meta. */
function publicName(basename: string): string {
  return basename.startsWith('onyx-') ? basename.slice(5) : basename
}

/** Inverse of publicName against the files on disk. */
function basenameForPublicName(name: string): string {
  if (existsSync(resolve(SCHEMAS_DIR, `onyx-${name}.schema.json`))) return `onyx-${name}`
  return name
}

function basenameToLockUrl(basename: string): string {
  return `hm://${ONYX}/${publicName(basename)}`
}

function hasSchemaFile(basename: string): boolean {
  return existsSync(resolve(SCHEMAS_DIR, `${basename}.schema.json`))
}

/** How documents of the space map onto hypermedia/. */
const layout: SpaceLayout = {
  pathForFile(file) {
    if (file.startsWith('site/')) {
      const name = file.slice('site/'.length).replace(/\.md$/, '')
      return name === 'home' ? '' : `/${name}`
    }
    if (file.includes('/')) return null
    const basename = file.replace(/\.md$/, '')
    // Only schema-backed top-level docs are published (README.md etc. are not).
    return hasSchemaFile(basename) ? `/${publicName(basename)}` : null
  },
  fileForPath(path, doc) {
    if (path === '') return 'site/home.md'
    const name = path.replace(/^\//, '')
    if (name.includes('/')) return `site/${name}.md`
    const basename = basenameForPublicName(name)
    const meta = (doc.metadata || {}) as Record<string, unknown>
    if (hasSchemaFile(basename) || meta.schemaDefinition) return `${basename}.md`
    return `site/${name}.md`
  },
  schemaFileFor(mdFile) {
    return mdFile.startsWith('site/') ? null : mdFile.replace(/\.md$/, '.schema.json')
  },
}

// ── Schema blobs ──────────────────────────────────────────────────────────────

type SchemaSet = {
  blobs: Array<{data: Uint8Array; cid: string}>
  cidByBasename: Map<string, string>
  /** Instance files ({$type, value}) by basename → their $type. */
  instanceTypeByBasename: Map<string, string>
}

/** Encode every schema file, verify it against the lockfile, and collect the blobs. */
async function loadSchemaBlobs(): Promise<SchemaSet> {
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as {schemas: Record<string, string>}
  const files = readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
  const set: SchemaSet = {blobs: [], cidByBasename: new Map(), instanceTypeByBasename: new Map()}
  let mismatches = 0
  for (const file of files) {
    const basename = file.replace(/\.schema\.json$/, '')
    const obj = JSON.parse(readFileSync(resolve(SCHEMAS_DIR, file), 'utf8'))
    if (obj && typeof obj === 'object' && typeof obj.$type === 'string' && 'value' in obj) {
      set.instanceTypeByBasename.set(basename, obj.$type)
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
    set.blobs.push({data: new Uint8Array(data), cid})
    set.cidByBasename.set(basename, cid)
  }
  if (mismatches > 0) {
    console.error(`\nFAILED: ${mismatches} schema CID mismatch(es). Run \`node hypermedia/publish.mjs\` and retry.`)
    process.exit(1)
  }
  return set
}

// ── Commands ──────────────────────────────────────────────────────────────────

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : undefined
}

async function push(args: string[]) {
  const dryRun = args.includes('--dry-run')
  const serverUrl = argValue(args, '--server') ?? 'https://hyper.media'
  const keyName = argValue(args, '--key') ?? 'main'

  // A dry run needs no signer: it only diffs against the server.
  const key = dryRun
    ? await resolveSigningKey(keyName, {dev: false}).catch(() => null)
    : await resolveSigningKey(keyName, {dev: false})
  const account = key?.accountId ?? argValue(args, '--space') ?? ONYX
  const signer = key
    ? createSignerFromKey(key)
    : {
        getPublicKey: () => {
          throw new Error('no signing key (dry run)')
        },
        sign: () => {
          throw new Error('no signing key (dry run)')
        },
      }
  console.log(
    `Account: ${account}${account === ONYX ? ' (onyx)' : '  ! not the onyx account'}${key ? '' : '  (no key)'}`,
  )
  console.log(`Server:  ${serverUrl}`)
  console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'PUBLISH'}\n`)

  const schemas = await loadSchemaBlobs()
  console.log(`Schema blobs: ${schemas.blobs.length} encoded, all CIDs match the lockfile.`)

  const client = createSeedClient(serverUrl)
  if (!dryRun) {
    console.log(`Publishing ${schemas.blobs.length} schema blobs...`)
    await client.publish({blobs: schemas.blobs})
    console.log('  done.\n')
  }

  const result = await importSpace({
    client,
    signer,
    account,
    dir: SCHEMAS_DIR,
    layout,
    dryRun,
    log: (line) => console.log('  ' + line),
    // A TYPE doc DEFINES its schema; an INSTANCE doc CONFORMS to its $type.
    metadataFor(file, metadata) {
      if (file.startsWith('site/')) return metadata
      const basename = file.replace(/\.md$/, '')
      const out = {...(metadata as Record<string, unknown>)}
      const instanceType = schemas.instanceTypeByBasename.get(basename)
      if (instanceType) {
        out.schema = instanceType
        delete out.schemaDefinition
      } else if (schemas.cidByBasename.has(basename)) {
        out.schemaDefinition = `ipfs://${schemas.cidByBasename.get(basename)}`
      }
      return out as HMMetadata
    },
  })

  console.log(
    `\n${dryRun ? 'DRY RUN' : 'DONE'}: ${result.created.length} created, ${result.updated.length} updated, ${
      result.unchanged.length
    } unchanged.`,
  )
  console.log(`Root: hm://${account}`)
}

async function pull(args: string[]) {
  const serverUrl = argValue(args, '--server') ?? 'https://hyper.media'
  const uid = argValue(args, '--space') ?? ONYX
  console.log(`Space:  hm://${uid}`)
  console.log(`Server: ${serverUrl}\n`)

  const client = createSeedClient(serverUrl)
  const result = await exportSpace({client, uid, dir: SCHEMAS_DIR, layout, log: (line) => console.log('  ' + line)})
  console.log(`\nPulled: ${result.written.length} written, ${result.unchanged.length} unchanged.`)

  // Schema files may have changed: refresh the lockfile and the bundled registry.
  for (const script of ['hypermedia/publish.mjs', 'scripts/gen-onyx.mjs']) {
    const run = spawnSync('node', [script], {cwd: REPO_ROOT, stdio: 'inherit'})
    if (run.status !== 0) throw new Error(`${script} failed`)
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'push') return push(args)
  if (command === 'pull') return pull(args)
  console.error(
    'usage: sync-onyx.ts push [--dry-run] [--server <url>] [--key <name>]\n       sync-onyx.ts pull [--server <url>] [--space <uid>]',
  )
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
