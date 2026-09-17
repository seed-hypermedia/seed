/**
 * Space archives — `space archive` / `space restore`: a whole space in one zip file.
 *
 * Two kinds, told apart by `manifest.json` at the root of the zip:
 *
 * - `blobs`: the signed blobs themselves, byte for byte, at `blobs/<cid>`. Refs,
 *   changes, capabilities, comments, schema blobs and the UnixFS blocks of every
 *   file they link, each checked against its CID. Restoring publishes them as is,
 *   to any server, so the space comes back with its history, signatures and
 *   authors intact. Nothing is re-signed.
 *
 * - `markdown`: the `space export` directory (lossless markdown plus schema
 *   files), with every file a document links (`ipfs://…`) downloaded to
 *   `assets/` and linked relatively. Readable without Seed. Restoring imports it
 *   into a space with a signing key, as `space import` does, which publishes new
 *   changes (and re-uploads the assets) under that key.
 */
import * as dagCbor from '@ipld/dag-cbor'
import * as dagPb from '@ipld/dag-pb'
import {fileToIpfsBlobs, type SeedClient} from '@seed-hypermedia/client'
import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {blake2b} from '@noble/hashes/blake2b'
import {sha256} from '@noble/hashes/sha256'
import {unzipSync, zipSync, type Zippable} from 'fflate'
import {CID} from 'multiformats/cid'
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {emptyExportResult, exportDocument, listSpaceDocuments} from './space-sync'

export const ARCHIVE_FORMAT = 'seed-space-archive'
export const ARCHIVE_VERSION = 1

export type ArchiveKind = 'blobs' | 'markdown'

export type ArchiveManifest = {
  format: typeof ARCHIVE_FORMAT
  version: number
  kind: ArchiveKind
  /** The space (account uid) archived. */
  space: string
  /** The server the archive was read from. */
  server: string
  createdAt: string
  /** Every document archived, with the version it had. */
  documents: Array<{path: string; version: string; genesis?: string; refs?: string[]}>
  /** Blob archives: every blob in `blobs/`, in the order restore publishes them. */
  blobs?: Array<{cid: string; size: number; type?: string}>
  /** Markdown archives: every downloaded asset, by CID. */
  assets?: Array<{cid: string; file: string; size: number}>
  /** CIDs something links that the server could not return (or returned with a wrong hash). */
  missing?: Array<{cid: string; reason: string}>
}

type Log = (line: string) => void

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!)
    }
  })
  await Promise.all(workers)
  return out
}

const CONCURRENCY = 8

// ─── CIDs and raw bytes ──────────────────────────────────────────────────────

const MH_IDENTITY = 0x00
const MH_SHA2_256 = 0x12
const MH_BLAKE2B_256 = 0xb220

/** Whether `bytes` hash to `cid`. Seed blobs use sha2-256 (SDK) or blake2b-256 (daemon). */
export function cidMatches(cid: CID, bytes: Uint8Array): boolean {
  const {code, digest} = cid.multihash
  let actual: Uint8Array
  if (code === MH_SHA2_256) actual = sha256(bytes)
  else if (code === MH_BLAKE2B_256) actual = blake2b(bytes, {dkLen: 32})
  else if (code === MH_IDENTITY) actual = bytes
  else return false
  return actual.length === digest.length && actual.every((b, i) => b === digest[i])
}

class FetchError extends Error {}

/**
 * The raw bytes of a dag-cbor or raw block, from the server's file proxy. (A
 * dag-pb UnixFS root comes back as the assembled file instead: see fetchFileDag.)
 */
async function fetchRaw(client: SeedClient, cid: string): Promise<Uint8Array> {
  const res = await fetch(`${client.baseUrl}/hm/api/file/${cid}`)
  if (!res.ok) throw new FetchError(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** A dag-pb node's exact bytes, rebuilt from the dag-json the server returns for it. */
async function fetchDagPbNode(client: SeedClient, cid: CID): Promise<Uint8Array> {
  const {value} = await client.request('GetCID', {cid: cid.toString()})
  if (!value || typeof value !== 'object') throw new FetchError('not found')
  const node = value as {
    Data?: {'/': {bytes: string}}
    Links?: Array<{Hash: {'/': string}; Name?: string; Tsize?: number}>
  }
  const pb: dagPb.PBNode = {
    Links: (node.Links || []).map((l) => ({
      Hash: CID.parse(l.Hash['/']),
      ...(l.Name !== undefined ? {Name: l.Name} : {}),
      ...(l.Tsize !== undefined ? {Tsize: l.Tsize} : {}),
    })) as unknown as dagPb.PBLink[],
    ...(node.Data ? {Data: Buffer.from(node.Data['/'].bytes, 'base64')} : {}),
  }
  return dagPb.encode(pb)
}

/**
 * Every block of a UnixFS file DAG. The quick path fetches the assembled file
 * once and chunks it the way the SDK does; when that reproduces the root CID the
 * blocks are exact. Otherwise (a file chunked differently, e.g. by another IPFS
 * implementation) the DAG is walked node by node.
 */
async function fetchFileDag(client: SeedClient, root: CID): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  const file = await fetchRaw(client, root.toString())
  const chunked = await fileToIpfsBlobs(file)
  if (chunked.cid === root.toString()) {
    // The chunker's blockstore keys blocks by multihash, so it reports every block
    // with the raw codec (the dag-pb nodes too). Walk from the root to name each
    // block with its real CID.
    const byHash = new Map(chunked.blobs.map((b) => [CID.parse(b.cid).multihash.bytes.toString(), b.data]))
    const walk = (cid: CID) => {
      const data = byHash.get(cid.multihash.bytes.toString())
      if (!data || out.has(cid.toString())) return
      out.set(cid.toString(), data)
      if (cid.code === dagPb.code) for (const link of dagPb.decode(data).Links) walk(link.Hash)
    }
    walk(root)
    if (out.size === chunked.blobs.length) return out
    out.clear()
  }
  const queue = [root]
  while (queue.length) {
    const batch = queue.splice(0, CONCURRENCY)
    await Promise.all(
      batch.map(async (cid) => {
        const key = cid.toString()
        if (out.has(key)) return
        let bytes: Uint8Array
        if (cid.code === dagPb.code) {
          bytes = await fetchDagPbNode(client, cid)
          for (const link of dagPb.decode(bytes).Links) queue.push(link.Hash)
        } else {
          bytes = await fetchRaw(client, key)
        }
        if (!cidMatches(cid, bytes)) throw new FetchError('hash mismatch')
        out.set(key, bytes)
      }),
    )
  }
  return out
}

/** Every CID link in a decoded dag-cbor value, and every `ipfs://<cid>` string in it. */
function scanLinks(value: unknown, links: CID[], ipfs: string[]) {
  if (value === null || value === undefined) return
  const asCid = CID.asCID(value)
  if (asCid) {
    links.push(asCid)
    return
  }
  if (typeof value === 'string') {
    const m = /^ipfs:\/\/([a-zA-Z0-9]+)/.exec(value)
    if (m) ipfs.push(m[1]!)
    return
  }
  if (value instanceof Uint8Array) return
  if (Array.isArray(value)) {
    for (const v of value) scanLinks(v, links, ipfs)
    return
  }
  if (typeof value === 'object') for (const v of Object.values(value)) scanLinks(v, links, ipfs)
}

// ─── Collecting a space's blobs ──────────────────────────────────────────────

export type CollectedSpaceBlobs = {
  documents: ArchiveManifest['documents']
  blobs: Map<string, Uint8Array>
  missing: Array<{cid: string; reason: string}>
}

/**
 * Every blob a space is made of. Starts from what the server lists (the Refs at
 * each document path, the changes of each document, capabilities and comments)
 * and follows every link from there: the CID links inside each blob (a Ref's
 * heads, a change's deps and genesis, a comment's thread) and the `ipfs://` files
 * its content points at. Links that leave the space's blobs are followed too, so
 * the archive is self-contained.
 */
export async function collectSpaceBlobs(opts: {
  client: SeedClient
  uid: string
  comments?: boolean
  log?: Log
}): Promise<CollectedSpaceBlobs> {
  const {client, uid} = opts
  const log = opts.log || (() => {})
  const docs = await listSpaceDocuments(client, uid)
  log(`found   ${docs.length} document${docs.length === 1 ? '' : 's'}`)

  const seeds = new Set<string>()
  const documents: ArchiveManifest['documents'] = []
  let refsUnsupported = false
  await mapPool(docs, CONCURRENCY, async (doc: HMDocument) => {
    const path = doc.path || ''
    const id = hmId(uid, {path: path ? path.replace(/^\//, '').split('/') : []})
    const entry: ArchiveManifest['documents'][number] = {path, version: doc.version, genesis: doc.genesis}
    documents.push(entry)
    for (const v of doc.version.split('.')) seeds.add(v)
    if (doc.genesis) seeds.add(doc.genesis)
    try {
      const {refs} = await client.request('ListRefs', {targetId: id})
      entry.refs = refs.map((r) => r.id!).filter(Boolean)
      for (const r of entry.refs) seeds.add(r)
    } catch (error) {
      refsUnsupported = true
    }
    const changes = await client.request('ListChanges', {targetId: id})
    for (const c of changes.changes) if (c.id) seeds.add(c.id)
    const caps = await client.request('ListCapabilities', {targetId: id})
    for (const c of caps.capabilities) if (c.id) seeds.add(c.id)
    if (opts.comments !== false) {
      const list = await client.request('ListComments', {targetId: id})
      for (const c of list.comments) if (c.version) for (const v of c.version.split('.')) seeds.add(v)
    }
  })
  documents.sort((a, b) => a.path.localeCompare(b.path))
  if (refsUnsupported) {
    log(
      `warning ${client.baseUrl} does not list Refs (ListRefs); the archive has the changes but not the Refs that place documents at their paths`,
    )
  }

  const blobs = new Map<string, Uint8Array>()
  const missing: CollectedSpaceBlobs['missing'] = []
  const visited = new Set<string>()
  let queue: Array<{cid: string; file: boolean}> = [...seeds].map((cid) => ({cid, file: false}))
  while (queue.length) {
    const next: typeof queue = []
    await mapPool(queue, CONCURRENCY, async ({cid: cidStr, file}) => {
      if (visited.has(cidStr)) return
      visited.add(cidStr)
      let cid: CID
      try {
        cid = CID.parse(cidStr)
      } catch {
        missing.push({cid: cidStr, reason: 'not a CID'})
        return
      }
      try {
        if (cid.code === dagPb.code || (file && cid.code !== dagCbor.code)) {
          for (const [k, bytes] of await fetchFileDag(client, cid)) {
            blobs.set(k, bytes)
            visited.add(k)
          }
          return
        }
        const bytes = await fetchRaw(client, cidStr)
        if (!cidMatches(cid, bytes)) throw new FetchError('hash mismatch')
        blobs.set(cidStr, bytes)
        if (cid.code !== dagCbor.code) return
        const links: CID[] = []
        const ipfs: string[] = []
        scanLinks(dagCbor.decode(bytes), links, ipfs)
        for (const l of links) next.push({cid: l.toString(), file: false})
        for (const f of ipfs) next.push({cid: f, file: true})
      } catch (error) {
        const reason = error instanceof FetchError ? error.message : (error as Error).message
        missing.push({cid: cidStr, reason})
      }
    })
    queue = next.filter((n) => !visited.has(n.cid))
    if (queue.length) log(`blobs   ${blobs.size} so far, following ${queue.length} more links`)
  }
  for (const m of missing) log(`missing ${m.cid} (${m.reason})`)
  return {documents, blobs, missing}
}

/** The `type` tag of a dag-cbor blob, if it has one. */
function blobType(cid: CID, bytes: Uint8Array): string | undefined {
  if (cid.code === dagPb.code) return 'unixfs'
  if (cid.code !== dagCbor.code) return 'raw'
  try {
    const v = dagCbor.decode(bytes) as Record<string, unknown>
    return typeof v?.type === 'string' ? v.type : undefined
  } catch {
    return undefined
  }
}

const TYPE_ORDER = ['raw', 'unixfs', 'Capability', 'Profile', 'Contact', 'Change', 'Ref', 'Comment']

/**
 * Publish order: files first, then signed blobs so that everything a blob
 * depends on is published before it (capabilities before the Refs that use
 * them, a change after its deps, a Ref after its changes, a reply after its
 * parent). Within a type, dependencies first, then by timestamp.
 */
export function orderBlobs(blobs: Map<string, Uint8Array>): Array<{cid: string; data: Uint8Array; type?: string}> {
  const entries = [...blobs].map(([cid, data]) => {
    const parsed = CID.parse(cid)
    const type = blobType(parsed, data)
    const links: CID[] = []
    let ts = 0
    if (parsed.code === dagCbor.code) {
      try {
        const v = dagCbor.decode(data) as Record<string, unknown>
        scanLinks(v, links, [])
        if (typeof v?.ts === 'number' || typeof v?.ts === 'bigint') ts = Number(v.ts)
      } catch {}
    }
    const rank = TYPE_ORDER.indexOf(type ?? '')
    return {cid, data, type, ts, rank: rank === -1 ? TYPE_ORDER.length : rank, deps: links.map(String)}
  })
  entries.sort((a, b) => a.rank - b.rank || a.ts - b.ts || a.cid.localeCompare(b.cid))
  const byCid = new Map(entries.map((e) => [e.cid, e]))
  const out: typeof entries = []
  const done = new Set<string>()
  const visit = (e: (typeof entries)[number], stack: Set<string>) => {
    if (done.has(e.cid) || stack.has(e.cid)) return
    stack.add(e.cid)
    for (const d of e.deps) {
      const dep = byCid.get(d)
      if (dep) visit(dep, stack)
    }
    done.add(e.cid)
    out.push(e)
  }
  for (const e of entries) visit(e, new Set())
  return out.map(({cid, data, type}) => ({cid, data, type}))
}

// ─── Assets for markdown archives ────────────────────────────────────────────

/** A file extension for bytes, from their magic numbers. '' when unknown. */
export function sniffExtension(bytes: Uint8Array): string {
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)
  const ascii = (s: string, offset = 0) =>
    starts(
      [...s].map((c) => c.charCodeAt(0)),
      offset,
    )
  if (starts([0x89, 0x50, 0x4e, 0x47])) return '.png'
  if (starts([0xff, 0xd8, 0xff])) return '.jpg'
  if (ascii('GIF8')) return '.gif'
  if (ascii('RIFF') && ascii('WEBP', 8)) return '.webp'
  if (ascii('%PDF')) return '.pdf'
  if (ascii('ftyp', 4)) return ascii('qt  ', 8) ? '.mov' : '.mp4'
  if (starts([0x1a, 0x45, 0xdf, 0xa3])) return '.webm'
  if (ascii('ID3') || starts([0xff, 0xfb])) return '.mp3'
  if (ascii('OggS')) return '.ogg'
  if (starts([0x50, 0x4b, 0x03, 0x04])) return '.zip'
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart()
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(head)) return '.svg'
  return ''
}

/** Downloads the files documents link into one directory, once per CID. */
export class AssetDownloader {
  private files = new Map<string, Promise<string | null>>()
  readonly assets: NonNullable<ArchiveManifest['assets']> = []
  readonly missing: NonNullable<ArchiveManifest['missing']> = []

  constructor(
    private client: SeedClient,
    /** The export directory. */
    private dir: string,
    /** Where assets go, relative to `dir`. */
    private assetsDir = 'assets',
    private log: Log = () => {},
  ) {}

  /** The asset file (relative to the export directory) for an `ipfs://<cid>` link; null when it can't be fetched. */
  fileFor(cid: string): Promise<string | null> {
    let p = this.files.get(cid)
    if (!p) {
      p = this.download(cid)
      this.files.set(cid, p)
    }
    return p
  }

  private async download(cid: string): Promise<string | null> {
    try {
      const bytes = await fetchRaw(this.client, cid)
      const file = `${this.assetsDir}/${cid}${sniffExtension(bytes)}`
      const full = resolve(this.dir, file)
      if (!existsSync(full) || statSync(full).size !== bytes.length) {
        mkdirSync(dirname(full), {recursive: true})
        writeFileSync(full, bytes)
        this.log(`asset   ${file}`)
      }
      this.assets.push({cid, file, size: bytes.length})
      return file
    } catch (error) {
      this.missing.push({cid, reason: (error as Error).message})
      this.log(`missing ${cid} (${(error as Error).message})`)
      return null
    }
  }

  /**
   * Download what a document links and point its file blocks at the local copies:
   * `ipfs://<cid>` becomes a link relative to the markdown file. Metadata files
   * (icon, cover) are downloaded but keep their `ipfs://` value, since frontmatter
   * is not uploaded on import.
   */
  async localize(nodes: HMBlockNode[], mdFile: string, metadata?: Record<string, unknown>): Promise<HMBlockNode[]> {
    for (const [key, value] of Object.entries(metadata || {})) {
      const m = key !== 'schemaDefinition' && typeof value === 'string' ? /^ipfs:\/\/([^/?#]+)$/.exec(value) : null
      if (m) await this.fileFor(m[1]!)
    }
    const fileDir = dirname(mdFile)
    const walk = async (list: HMBlockNode[]): Promise<HMBlockNode[]> =>
      Promise.all(
        list.map(async (node) => {
          const block = node.block as Record<string, unknown>
          let next = node
          const m =
            typeof block.link === 'string' && ['Image', 'Video', 'File'].includes(block.type as string)
              ? /^ipfs:\/\/([^/?#]+)$/.exec(block.link)
              : null
          if (m) {
            const file = await this.fileFor(m[1]!)
            if (file) {
              let rel = relative(fileDir, file).replace(/\\/g, '/')
              if (!rel.startsWith('.')) rel = './' + rel
              next = {...node, block: {...block, link: rel} as HMBlockNode['block']}
            }
          }
          return node.children ? {...next, children: await walk(node.children)} : next
        }),
      )
    return walk(nodes)
  }
}

// ─── Zip ─────────────────────────────────────────────────────────────────────

function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full).replace(/\\/g, '/'))
    }
  }
  walk(dir)
  return out
}

const STORED = /\.(png|jpe?g|gif|webp|pdf|mp4|mov|webm|mp3|ogg|zip)$/i

export function writeZip(file: string, entries: Zippable) {
  mkdirSync(dirname(resolve(file)), {recursive: true})
  writeFileSync(file, zipSync(entries, {level: 6}))
}

/** Read a space archive: its manifest and every other file in it. */
export function readArchive(file: string): {manifest: ArchiveManifest; files: Map<string, Uint8Array>} {
  const entries = unzipSync(new Uint8Array(readFileSync(file)))
  const raw = entries['manifest.json']
  if (!raw) throw new Error(`${file} is not a space archive: no manifest.json`)
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as ArchiveManifest
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error(`${file} is not a space archive (format ${manifest.format})`)
  if (manifest.version > ARCHIVE_VERSION) {
    throw new Error(`${file} is archive version ${manifest.version}; this CLI reads up to ${ARCHIVE_VERSION}`)
  }
  const files = new Map<string, Uint8Array>()
  for (const [name, data] of Object.entries(entries)) {
    if (name !== 'manifest.json' && !name.endsWith('/')) files.set(name, data)
  }
  return {manifest, files}
}

// ─── Archive ─────────────────────────────────────────────────────────────────

export type ArchiveOptions = {
  client: SeedClient
  uid: string
  kind: ArchiveKind
  /** The zip file to write. */
  out: string
  /** Blob archives: include comments on the space's documents (default true). */
  comments?: boolean
  /** Markdown archives: a scratch directory to export into. */
  workDir: string
  log?: Log
}

export type ArchiveResult = {manifest: ArchiveManifest; bytes: number}

export async function archiveSpace(opts: ArchiveOptions): Promise<ArchiveResult> {
  const log = opts.log || (() => {})
  const base = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    kind: opts.kind,
    space: opts.uid,
    server: opts.client.baseUrl,
    createdAt: new Date().toISOString(),
  } as const
  let manifest: ArchiveManifest
  const entries: Zippable = {}

  if (opts.kind === 'blobs') {
    const collected = await collectSpaceBlobs({client: opts.client, uid: opts.uid, comments: opts.comments, log})
    const ordered = orderBlobs(collected.blobs)
    manifest = {
      ...base,
      documents: collected.documents,
      blobs: ordered.map((b) => ({cid: b.cid, size: b.data.length, ...(b.type ? {type: b.type} : {})})),
      missing: collected.missing,
    }
    for (const b of ordered) {
      entries[`blobs/${b.cid}`] = [b.data, {level: b.type === 'raw' || b.type === 'unixfs' ? 0 : 6}]
    }
  } else {
    const dir = resolve(opts.workDir)
    const assets = new AssetDownloader(opts.client, dir, 'assets', log)
    const docs = await listSpaceDocuments(opts.client, opts.uid)
    const result = emptyExportResult()
    await mapPool(docs, CONCURRENCY, (doc) => exportDocument({client: opts.client, dir, log, assets}, doc, result))
    manifest = {
      ...base,
      documents: docs
        .map((d) => ({path: d.path || '', version: d.version, genesis: d.genesis}))
        .sort((a, b) => a.path.localeCompare(b.path)),
      assets: assets.assets.sort((a, b) => a.file.localeCompare(b.file)),
      missing: assets.missing,
    }
    for (const f of listFiles(dir)) {
      entries[f] = [new Uint8Array(readFileSync(join(dir, f))), {level: STORED.test(f) ? 0 : 6}]
    }
  }
  entries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n')
  writeZip(opts.out, entries)
  return {manifest, bytes: statSync(opts.out).size}
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/** Max bytes per PublishBlobs request. */
const PUBLISH_BATCH_BYTES = 4 * 1024 * 1024
const PUBLISH_BATCH_COUNT = 200

/**
 * Publish every blob of a blob archive, in manifest order, after checking each
 * against its CID. Returns how many were published.
 */
export async function restoreBlobs(opts: {
  client: SeedClient
  manifest: ArchiveManifest
  files: Map<string, Uint8Array>
  dryRun?: boolean
  log?: Log
}): Promise<{published: number; bytes: number}> {
  const log = opts.log || (() => {})
  const listed = opts.manifest.blobs ?? []
  const blobs: Array<{cid: string; data: Uint8Array}> = []
  const bad: string[] = []
  for (const {cid} of listed) {
    const data = opts.files.get(`blobs/${cid}`)
    if (!data) bad.push(`${cid}: listed in the manifest but not in the archive`)
    else if (!cidMatches(CID.parse(cid), data)) bad.push(`${cid}: bytes do not match the CID`)
    else blobs.push({cid, data})
  }
  if (bad.length) throw new Error(`The archive is damaged:\n  ${bad.slice(0, 20).join('\n  ')}`)
  const bytes = blobs.reduce((n, b) => n + b.data.length, 0)
  if (opts.dryRun) return {published: 0, bytes}

  let published = 0
  let batch: typeof blobs = []
  let batchBytes = 0
  const flush = async () => {
    if (!batch.length) return
    await opts.client.publish({blobs: batch})
    published += batch.length
    log(`publish ${published}/${blobs.length} blobs`)
    batch = []
    batchBytes = 0
  }
  for (const b of blobs) {
    if (batch.length && (batchBytes + b.data.length > PUBLISH_BATCH_BYTES || batch.length >= PUBLISH_BATCH_COUNT)) {
      await flush()
    }
    batch.push(b)
    batchBytes += b.data.length
  }
  await flush()
  return {published, bytes}
}

/** Unpack a markdown archive into `dir` (for `space import`). Returns the files written. */
export function extractMarkdownArchive(files: Map<string, Uint8Array>, dir: string): string[] {
  const root = resolve(dir)
  const written: string[] = []
  for (const [name, data] of files) {
    const full = resolve(root, name)
    if (!full.startsWith(root + sep)) throw new Error(`Refusing to extract ${name} outside ${dir}`)
    mkdirSync(dirname(full), {recursive: true})
    writeFileSync(full, data)
    written.push(name)
  }
  return written
}
