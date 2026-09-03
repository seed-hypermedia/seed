/**
 * sync-hypermedia.ts — the hypermedia/ schema library ⇄ its Hypermedia site.
 *
 *   cd frontend/apps/cli
 *   bun run src/sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>]
 *   bun run src/sync-hypermedia.ts pull [--server <url>] [--space <uid>]
 *   bun run src/sync-hypermedia.ts dev  [--api <url>] [--daemon <url>] [--no-push]
 *
 * push: verify every hypermedia/*.schema.json against schemas.lock.json,
 *       publish the schema blobs, then import hypermedia/ as documents. A
 *       document that already exists is updated by block id on its existing
 *       genesis; unchanged documents are skipped.
 * pull: export every document of the space back into hypermedia/ — markdown
 *       per document, and the schema blob of each type document as its
 *       co-located *.schema.json — then refresh schemas.lock.json and the
 *       bundled schema registry.
 * dev:  the local editing loop. Publishes hypermedia/ into the daemon behind a
 *       running desktop dev app under a throwaway dev key (hypermedia/.dev/,
 *       gitignored), opens the site, and writes every document published
 *       there back into hypermedia/ as you edit in the app.
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
import {existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs'
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
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import * as dagCbor from '@ipld/dag-cbor'
import {createSeedClient, type HMSigner, type SeedClient} from '@seed-hypermedia/client'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {deriveKeyPairFromMnemonic, generateMnemonic, type KeyPair} from './utils/key-derivation'
import {resolveSigningKey} from './utils/keys'
import {createSignerFromKey} from './utils/signer'
import {exportPath, exportSpace, importSpace, listSpaceVersions, type SpaceLayout} from './utils/space-sync'

// ── Paths ─────────────────────────────────────────────────────────────────────

const DIR = dirname(fileURLToPath(import.meta.url)) // frontend/apps/cli/src
const REPO_ROOT = resolve(DIR, '../../../..')
const SCHEMAS_DIR = resolve(REPO_ROOT, 'hypermedia')
const LOCK_PATH = resolve(SCHEMAS_DIR, 'schemas.lock.json')

// ── Naming ────────────────────────────────────────────────────────────────────

/** The space the library is published under. */
const SITE = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

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
  return `hm://${SITE}/${publicName(basename)}`
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

/** A TYPE doc DEFINES its schema; an INSTANCE doc CONFORMS to its $type. */
function schemaMetadataFor(schemas: SchemaSet) {
  return (file: string, metadata: HMMetadata): HMMetadata => {
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
  }
}

/** Publish the schema blobs, then import hypermedia/ into `account` on `client`. */
async function pushTo(client: SeedClient, signer: HMSigner, account: string, dryRun: boolean) {
  const schemas = await loadSchemaBlobs()
  console.log(`Schema blobs: ${schemas.blobs.length} encoded, all CIDs match the lockfile.`)
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
    metadataFor: schemaMetadataFor(schemas),
  })
  console.log(
    `\n${dryRun ? 'DRY RUN' : 'DONE'}: ${result.created.length} created, ${result.moved.length} moved, ${
      result.updated.length
    } updated, ${result.unchanged.length} unchanged.`,
  )
  return result
}

/** Refresh the lockfile and the bundled registry after schema files changed. */
function refreshSchemaArtifacts() {
  for (const script of ['hypermedia/publish.mjs', 'scripts/gen-onyx.mjs']) {
    const run = spawnSync('node', [script], {cwd: REPO_ROOT, stdio: 'inherit'})
    if (run.status !== 0) throw new Error(`${script} failed`)
  }
}

async function push(args: string[]) {
  const dryRun = args.includes('--dry-run')
  const serverUrl = argValue(args, '--server') ?? 'https://hyper.media'
  const keyName = argValue(args, '--key') ?? 'main'

  // A dry run needs no signer: it only diffs against the server.
  const key = dryRun
    ? await resolveSigningKey(keyName, {dev: false}).catch(() => null)
    : await resolveSigningKey(keyName, {dev: false})
  const account = key?.accountId ?? argValue(args, '--space') ?? SITE
  const signer = key ? createSignerFromKey(key) : noSigner()
  console.log(
    `Account: ${account}${account === SITE ? ' (the site)' : '  ! not the site account'}${key ? '' : '  (no key)'}`,
  )
  console.log(`Server:  ${serverUrl}`)
  console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'PUBLISH'}\n`)

  await pushTo(createSeedClient(serverUrl), signer, account, dryRun)
  console.log(`Root: hm://${account}`)
}

function noSigner(): HMSigner {
  const fail = () => {
    throw new Error('no signing key (dry run)')
  }
  return {getPublicKey: fail, sign: fail}
}

async function pull(args: string[]) {
  const serverUrl = argValue(args, '--server') ?? 'https://hyper.media'
  const uid = argValue(args, '--space') ?? SITE
  console.log(`Space:  hm://${uid}`)
  console.log(`Server: ${serverUrl}\n`)

  const client = createSeedClient(serverUrl)
  const result = await exportSpace({client, uid, dir: SCHEMAS_DIR, layout, log: (line) => console.log('  ' + line)})
  console.log(`\nPulled: ${result.written.length} written, ${result.unchanged.length} unchanged.`)
  refreshSchemaArtifacts()
}

// ── dev: the local editing loop ───────────────────────────────────────────────
//
// Publishes hypermedia/ into the daemon behind a running desktop dev app under
// a throwaway key, then watches that daemon and writes every document you
// publish there back into hypermedia/. The app is the editor; git is where you
// commit. Nothing reaches the network until you `push`.

const DEV_DIR = resolve(SCHEMAS_DIR, '.dev')
const DEV_MNEMONIC_FILE = resolve(DEV_DIR, 'dev-key.mnemonic')

/** The unencrypted dev key: a mnemonic in a gitignored file, created on first use. */
function loadOrCreateDevKey(): {keyPair: KeyPair; words: string[]; created: boolean} {
  let words: string[]
  let created = false
  if (existsSync(DEV_MNEMONIC_FILE)) {
    words = readFileSync(DEV_MNEMONIC_FILE, 'utf8').trim().split(/\s+/)
  } else {
    words = generateMnemonic(12).split(' ')
    mkdirSync(DEV_DIR, {recursive: true})
    writeFileSync(DEV_MNEMONIC_FILE, words.join(' ') + '\n', {mode: 0o600})
    created = true
  }
  return {keyPair: deriveKeyPairFromMnemonic(words), words, created}
}

/** Make sure the daemon holds the dev key, so the app can edit as that account. */
async function ensureDaemonKey(daemonUrl: string, words: string[], accountId: string) {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const existing = await grpc.daemon.listKeys({})
  if (existing.keys.some((k) => k.publicKey === accountId)) return
  const name = `dev-${accountId.slice(-6)}`
  await grpc.daemon.registerKey({mnemonic: words, name})
  console.log(`Registered key "${name}" in the daemon.`)
}

async function dev(args: string[]) {
  const apiUrl = argValue(args, '--api') ?? 'http://localhost:58004'
  const daemonUrl = argValue(args, '--daemon') ?? 'http://localhost:58001'
  const intervalMs = Number(argValue(args, '--interval') ?? 2000)
  const skipPush = args.includes('--no-push')

  const {keyPair, words, created} = loadOrCreateDevKey()
  const account = keyPair.accountId
  console.log(`Dev key: ${account}${created ? ' (new; saved to hypermedia/.dev/)' : ''}`)
  console.log(`Daemon:  ${daemonUrl}`)
  console.log(`API:     ${apiUrl}\n`)

  try {
    await ensureDaemonKey(daemonUrl, words, account)
  } catch (err) {
    throw new Error(
      `Cannot reach the daemon at ${daemonUrl} (${
        (err as Error).message
      }). Start the desktop dev app first (./dev run-desktop).`,
    )
  }

  const client = createSeedClient(apiUrl)
  const signer = createSignerFromKey(keyPair)

  if (!skipPush) {
    console.log('Pushing hypermedia/ into the local daemon...')
    await pushTo(client, signer, account, false)
    console.log('')
  }

  const url = `hm://${account}`
  console.log(`Site: ${url}`)
  console.log('Open it in the desktop app (paste the URL in the omnibar). Edit and publish; files update here.')
  spawnSync('open', [url], {stdio: 'ignore'})

  // Watch: poll document versions and write back whatever changed.
  let versions = await listSpaceVersions(client, account)
  // Which file each document lives in, so a document moved in the app takes
  // its file along (the old one is removed).
  const files = (await exportSpace({client, uid: account, dir: SCHEMAS_DIR, layout})).files
  console.log(`Watching ${versions.size} documents every ${intervalMs}ms. Ctrl-C to stop.\n`)
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs))
    let next: Map<string, string>
    try {
      next = await listSpaceVersions(client, account)
    } catch (err) {
      console.log(`  ! poll failed: ${(err as Error).message}`)
      continue
    }
    let schemaChanged = false
    for (const [path, version] of next) {
      if (versions.get(path) === version) continue
      try {
        const res = await exportPath({client, uid: account, dir: SCHEMAS_DIR, layout}, path)
        for (const file of res.written) {
          console.log(`  ${new Date().toLocaleTimeString()}  wrote ${file}`)
          if (file.endsWith('.schema.json')) schemaChanged = true
        }
        if (res.written.length === 0)
          console.log(`  ${new Date().toLocaleTimeString()}  ${path || '(home)'} republished, no file change`)
        if (res.file) files.set(path, res.file)
      } catch (err) {
        console.log(`  ! ${path || '(home)'}: ${(err as Error).message}`)
      }
    }
    // A path that vanished was moved away (or deleted): drop its file.
    for (const [path] of versions) {
      if (next.has(path)) continue
      const file = files.get(path)
      if (!file) continue
      try {
        unlinkSync(resolve(SCHEMAS_DIR, file))
        console.log(`  ${new Date().toLocaleTimeString()}  removed ${file}`)
      } catch {
        // already gone
      }
      files.delete(path)
    }
    versions = next
    if (schemaChanged) refreshSchemaArtifacts()
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'push') return push(args)
  if (command === 'pull') return pull(args)
  if (command === 'dev') return dev(args)
  console.error(
    [
      'usage: sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>]',
      '       sync-hypermedia.ts pull [--server <url>] [--space <uid>]',
      '       sync-hypermedia.ts dev  [--api <url>] [--daemon <url>] [--interval <ms>] [--no-push]',
    ].join('\n'),
  )
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
