/**
 * Repo HM sync (space ⇄ directory): export every document of a space to markdown files
 * (plus the schema blob a type document defines), and import a directory of
 * markdown files back as document updates.
 *
 * The markdown is the lossless dialect of `@seed-hypermedia/client`
 * (`blocksToMarkdown` / `parseMarkdown`), so a document exported and
 * re-imported without edits produces no change at all. Imports diff by block
 * id against the current document and publish a Change on its existing
 * genesis; a path with no document yet gets a fresh one. Unchanged documents
 * are skipped, so a sync never spams versions.
 *
 * A `SpaceLayout` maps document paths to files. The default layout puts the
 * home document at `index.md` and `/a/b` at `a/b.md`; a schema blob goes to
 * `<file>.schema.json` beside the document that defines it.
 *
 * Schemas travel with their documents. Export writes the DAG-CBOR blob a
 * document's `metadata.schemaDefinition` points at as `<file>.schema.json` (and leaves
 * `schemaDefinition` out of that file's frontmatter);
 * import encodes that file back to canonical DAG-CBOR, publishes the blob with
 * the document, and sets `schemaDefinition: ipfs://<cid>` (the file is the
 * truth, whatever the frontmatter says). A document that CONFORMS to a type says so in its
 * frontmatter (`attributesSchema`), like any other typed document.
 *
 * Other files travel the same way. A frontmatter value that is a relative path (`code:
 * ./convert.ts`, `icon: ./icon.png`, a folder) names a file beside the page: import publishes it
 * as the blob the attribute references (a folder as a UnixFS directory, a `.json` file as a
 * DAG-CBOR object, anything else as a UnixFS file) and sets the attribute to `ipfs://<cid>`;
 * export keeps the path in the frontmatter and writes the file from the blob when the app
 * changed it. The file is the truth, as the schema file is.
 */
import {effectiveSchemaRef, loadSchema, metadataViolations} from './schema'
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, normalize, relative, resolve} from 'node:path'
import {
  blocksToMarkdown,
  createCapability,
  createChange,
  createChangeOps,
  createRedirectRef,
  createTombstoneRef,
  createVersionRef,
  flattenToOperations,
  markdownBlockNodesToHMBlockNodes,
  parseMarkdown,
  resolveEditableDocument,
  type BlockNode,
  type DocumentOperation,
  type HMSigner,
  type SeedClient,
  assertValidMermaid,
  directoryToIpfsBlobs,
  fileToIpfsBlobs,
  type CollectedBlob,
} from '@seed-hypermedia/client'
import {loadMermaidParser} from '@seed-hypermedia/client/mermaid-parser'
import {
  computeReplaceOps,
  createBlocksMap,
  rebindTableIdentities,
  toAPIBlockNode,
} from '@seed-hypermedia/client/block-diff'
import type {HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import * as dagCbor from '@ipld/dag-cbor'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {hmBlockNodeToBlockNode} from './block-diff'
import {resolveFileLinks} from './file-links'

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!, i)
    }
  })
  // A failed worker must not leave other requests running into the next sync pass.
  const settled = await Promise.allSettled(workers)
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
  return out
}

/** How many documents are fetched or published at once. */
const CONCURRENCY = 6

// ─── Layout ──────────────────────────────────────────────────────────────────

export type SpaceLayout = {
  /** Local markdown file (relative to the directory) for a document path; '' is the home document. Null skips it. */
  fileForPath(path: string, doc: HMDocument): string | null
  /** Document path for a markdown file (relative to the directory). Null skips the file. */
  pathForFile(file: string): string | null
  /** File for the schema blob a document defines (`metadata.schemaDefinition`). Null skips it. */
  schemaFileFor(mdFile: string): string | null
  /**
   * File a link to a document path points at, for rewriting links between
   * documents of the space as relative file links (and back). Null leaves the
   * hm:// link as is.
   */
  fileForLinkPath?(path: string): string | null
  /**
   * A name the files use for this space's own documents instead of its key, e.g. `hyper.media` in
   * `hm://hyper.media/protocol/documents`. Import resolves it to the publishing space's key in links
   * and metadata, and export writes it back, so the files never name a key.
   */
  selfAuthority?: string
}

/** Every `hm://<from>` URL in a value (a string, or strings nested in lists and maps) with its authority set to `to`. */
export function swapAuthority<T>(value: T, from: string, to: string): T {
  const re = new RegExp(`^hm://${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[/?#])`)
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(re, `hm://${to}`)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object' && !(v instanceof Uint8Array))
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}

export const defaultLayout: SpaceLayout = {
  fileForPath: (path) => (path === '' ? 'index.md' : path.replace(/^\//, '') + '.md'),
  pathForFile: (file) => (file === 'index.md' ? '' : '/' + file.replace(/\.md$/, '')),
  schemaFileFor: (mdFile) => mdFile.replace(/\.md$/, '.schema.json'),
  fileForLinkPath: (path) => (path === '' ? 'index.md' : path.replace(/^\//, '') + '.md'),
}

// ─── Links between documents ─────────────────────────────────────────────────
//
// In the directory, documents link to each other with relative file links
// (`[CLI](./cli.md)`), which render on GitHub and need no space id. In the
// space they are hm:// links. Import and export rewrite between the two.

type LinkVisitor = (link: string) => string

/** Rewrite every block link and Link/Embed annotation link in a tree. */
function rewriteLinks(nodes: HMBlockNode[], visit: LinkVisitor): HMBlockNode[] {
  return nodes.map((node) => {
    const block = {...(node.block as Record<string, unknown>)}
    if (typeof block.link === 'string' && block.link) block.link = visit(block.link)
    const anns = block.annotations as Array<Record<string, unknown>> | undefined
    if (anns?.length) {
      block.annotations = anns.map((a) => (typeof a.link === 'string' && a.link ? {...a, link: visit(a.link)} : a))
    }
    return {
      ...node,
      block: block as HMBlockNode['block'],
      ...(node.children ? {children: rewriteLinks(node.children, visit)} : {}),
    } as HMBlockNode
  })
}

/** `./other.md` (relative to `file`) → `hm://<account>/<path>` when the layout knows the target. */
function relativeToHmLinks(nodes: HMBlockNode[], file: string, account: string, layout: SpaceLayout): HMBlockNode[] {
  const fileDir = dirname(file)
  return rewriteLinks(nodes, (link) => {
    // Only relative paths: a link with a scheme (`https://…/README.md`,
    // `mailto:`) or an absolute path is not a file in this directory.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(link) || link.startsWith('/')) return link
    const m = /^(\.{1,2}\/[^#?]*\.md|[^#?]+\.md)(#.*)?$/.exec(link)
    if (!m) return link
    const target = normalize(join(fileDir, m[1]!)).replace(/\\/g, '/')
    const path = layout.pathForFile(target)
    if (path === null) return link
    return `hm://${account}${path}${m[2] || ''}`
  })
}

/**
 * Relative links to files that are not documents (`./images/x.png`, `./spec.pdf`)
 * become `file://` links to their absolute path, which the import uploads as
 * blobs (resolveFileLinks). The parser already writes `file://./x` for a
 * relative image; anything still relative that exists on disk is treated the
 * same. Links that resolve to nothing are left alone for the link check.
 */
function relativeAssetsToFileLinks(nodes: HMBlockNode[], dir: string, file: string): HMBlockNode[] {
  const fileDir = resolve(dir, dirname(file))
  return rewriteLinks(nodes, (link) => {
    let rel: string | null = null
    if (/^file:\/\/(?!\/)/.test(link)) rel = link.slice('file://'.length)
    else if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(link) && !link.startsWith('/') && !link.startsWith('#')) rel = link
    if (rel === null || /\.md(#.*)?$/.test(rel)) return link
    const abs = resolve(fileDir, rel.split('#')[0]!)
    return existsSync(abs) && statSync(abs).isFile() ? `file://${abs}` : link
  })
}

export type BrokenLink = {file: string; link: string; reason: string}

/** Every link in a tree: block links and annotation links. */
function collectLinks(nodes: HMBlockNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    const block = node.block as Record<string, unknown>
    if (typeof block.link === 'string' && block.link) out.push(block.link)
    for (const a of (block.annotations as Array<Record<string, unknown>> | undefined) || []) {
      if (typeof a.link === 'string' && a.link) out.push(a.link)
    }
    if (node.children) collectLinks(node.children, out)
  }
  return out
}

/**
 * Links that would be broken once published: a link into this space whose
 * path no file in the directory publishes, a relative file link that resolves
 * to nothing, or a `file://` asset that does not exist. External links
 * (http, ipfs, other spaces) are not checked.
 */
export function findBrokenLinks(
  file: string,
  nodes: HMBlockNode[],
  account: string,
  publishedPaths: Set<string>,
): BrokenLink[] {
  const broken: BrokenLink[] = []
  for (const link of collectLinks(nodes)) {
    const space = new RegExp(`^hm://${account}(/[^#?]*)?([#?].*)?$`).exec(link)
    if (space) {
      const path = (space[1] || '').replace(/\/$/, '')
      if (!publishedPaths.has(path)) {
        broken.push({file, link, reason: `no document at ${path || '(home)'} in the directory`})
      }
      continue
    }
    if (link.startsWith('file://')) {
      if (!existsSync(link.slice('file://'.length))) broken.push({file, link, reason: 'file not found'})
      continue
    }
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(link) && !link.startsWith('#') && !link.startsWith('/')) {
      broken.push({file, link, reason: 'relative link resolves to no published document or file'})
    }
  }
  return broken
}

/** `hm://<account>/<path>` → `./other.md` (relative to `file`) when the layout maps the path to a file. */
function hmToRelativeLinks(nodes: HMBlockNode[], file: string, account: string, layout: SpaceLayout): HMBlockNode[] {
  if (!layout.fileForLinkPath) return nodes
  const fileDir = dirname(file)
  return rewriteLinks(nodes, (link) => {
    const m = new RegExp(`^hm://${account}(/[^#?]*)?(#.*)?$`).exec(link)
    if (!m) return link
    const target = layout.fileForLinkPath!(m[1] || '')
    if (!target) return link
    let rel = relative(fileDir, target).replace(/\\/g, '/')
    if (!rel.startsWith('.')) rel = './' + rel
    return rel + (m[2] || '')
  })
}

// ─── Export ──────────────────────────────────────────────────────────────────

export type ExportOptions = {
  client: SeedClient
  /** The space (account uid) to export. */
  uid: string
  dir: string
  layout?: SpaceLayout
  /**
   * Download the files documents link (`ipfs://…` images, videos, files) and
   * link them relatively instead. See AssetDownloader in space-archive.ts.
   */
  assets?: {
    localize(nodes: HMBlockNode[], mdFile: string, metadata?: Record<string, unknown>): Promise<HMBlockNode[]>
  }
  /** Keep an existing Markdown file byte-for-byte when it already represents the exported document. */
  preserveSource?: boolean
  /** Recheck the checkout immediately before writing a file after asynchronous work. */
  beforeWrite?: (file: string) => void
  /** Called synchronously after each file write, before another network request can yield. */
  onWrite?: (file: string) => void
  log?: (line: string) => void
}

export type ExportResult = {
  written: string[]
  unchanged: string[]
  skipped: string[]
  /** Markdown file written (or found unchanged) for each document path. */
  files: Map<string, string>
}

export function emptyExportResult(): ExportResult {
  return {written: [], unchanged: [], skipped: [], files: new Map()}
}

/** Every document in a space: the home document plus all descendants. */
export async function listSpaceDocuments(client: SeedClient, uid: string): Promise<HMDocument[]> {
  const docs: HMDocument[] = []
  const home = await client.request('Resource', hmId(uid))
  if (home.type === 'document') docs.push(home.document)
  const query = await client.request('Query', {includes: [{space: uid, path: '', mode: 'AllDescendants'}]})
  const infos = (query?.results || []).filter((info) => info.type === 'document')
  const fetched = await mapPool(infos, CONCURRENCY, (info) => client.request('Resource', hmId(uid, {path: info.path})))
  for (const res of fetched) if (res.type === 'document') docs.push(res.document)
  return docs
}

/** Write `content` to `file` unless it already holds exactly that. */
function writeIfChanged(file: string, content: string): boolean {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return false
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, content)
  return true
}

/** The bare CID in an `ipfs://<cid>` metadata value. */
export function ipfsCid(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^ipfs:\/\/([^/]+)/.exec(value)
  return m ? m[1]! : null
}

/**
 * Order-preserving JSON write: keys keep the order they have in the file on
 * disk (new keys appended, sorted), so a re-exported schema that changed in
 * one place produces a one-place diff. A semantically equal object is not
 * rewritten at all.
 */
export function writeJsonPreservingOrder(file: string, value: unknown): boolean {
  let existing: unknown = undefined
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      existing = undefined
    }
  }
  if (existing !== undefined && deepEqual(existing, value)) return false
  const ordered = reorderLike(value, existing)
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n')
  return true
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

function reorderLike(value: unknown, template: unknown): unknown {
  if (Array.isArray(value)) {
    const t = Array.isArray(template) ? template : []
    return value.map((v, i) => reorderLike(v, t[i]))
  }
  if (!isObject(value)) return value
  const t = isObject(template) ? template : {}
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(t)) if (k in value) out[k] = reorderLike(value[k], t[k])
  for (const k of Object.keys(value).sort()) if (!(k in out)) out[k] = reorderLike(value[k], undefined)
  return out
}

/** Retain explicit identities and match missing identities by position, including partially annotated files. */
function matchMarkdownIdentities(oldNodes: ReturnType<typeof toAPIBlockNode>[], tree: BlockNode[], source: string) {
  const explicit = new Set(explicitBlockIds(source, tree))
  // Files often mix existing identity comments with newly written paragraphs without them.
  // Match only the missing identities; an explicit replacement must remain a real change.
  const match = (old: typeof oldNodes, nodes: BlockNode[]): BlockNode[] =>
    nodes.map((node, i) => {
      const previous = explicit.has(node.block.id) ? old.find((n) => n.block.id === node.block.id) : old[i]
      const id =
        !explicit.has(node.block.id) && previous?.block.type === node.block.type && !explicit.has(previous.block.id)
          ? previous.block.id
          : node.block.id
      return {
        block: {...node.block, id},
        children: node.block.type === 'Table' ? node.children : match(previous?.children ?? [], node.children),
      }
    })
  return rebindTableIdentities(oldNodes, match(oldNodes, tree))
}

/** Whether two Markdown sources describe the same content, metadata, and explicit block identities. */
export function markdownEquivalent(source: string, exported: string): boolean {
  if (source === exported) return true
  const local = parseMarkdown(source)
  const remote = parseMarkdown(exported)
  if (!deepEqual(local.metadata, remote.metadata)) return false
  const oldNodes = markdownBlockNodesToHMBlockNodes(remote.tree).map(toAPIBlockNode)
  const matched = matchMarkdownIdentities(oldNodes, local.tree, source)
  return computeReplaceOps(createBlocksMap(oldNodes), matched).length === 0
}

/** Write one document (and the schema it defines) into the directory. */
export async function exportDocument(
  opts: Omit<ExportOptions, 'uid'>,
  doc: HMDocument,
  result: ExportResult = emptyExportResult(),
): Promise<ExportResult> {
  const layout = opts.layout || defaultLayout
  const log = opts.log || (() => {})
  const path = doc.path || ''
  const file = layout.fileForPath(path, doc)
  if (!file) {
    result.skipped.push(path || '(home)')
    return result
  }
  result.files.set(path, file)
  const schemaCid = ipfsCid((doc.metadata as Record<string, unknown> | undefined)?.schemaDefinition)
  const schemaFile = schemaCid ? layout.schemaFileFor(file) : null
  // The schema file beside the page is the truth about what it defines, and import sets
  // `schemaDefinition` from it, so the frontmatter does not repeat the CID.
  const metadata = schemaFile
    ? (Object.fromEntries(
        Object.entries(doc.metadata || {}).filter(([key]) => key !== 'schemaDefinition'),
      ) as HMDocument['metadata'])
    : doc.metadata
  let relative = hmToRelativeLinks(doc.content || [], file, doc.account, layout)
  if (opts.assets) relative = await opts.assets.localize(relative, file, doc.metadata as Record<string, unknown>)
  const self = layout.selfAuthority
  const content = self ? rewriteLinks(relative, (link) => swapAuthority(link, doc.account, self)) : relative
  const ownMetadata = self && metadata ? swapAuthority(metadata, doc.account, self) : metadata
  // The files the local page names keep their place in the frontmatter, and are written from the
  // blobs only when the app changed them, before the page is compared with what is on disk.
  const assets = await restoreAttributeAssets(opts.client, opts.dir, file, ownMetadata, {
    beforeWrite: opts.beforeWrite,
    onWrite: opts.onWrite,
    log,
  })
  result.written.push(...assets.written)
  result.unchanged.push(...assets.unchanged)
  const md = blocksToMarkdown({...doc, metadata: assets.metadata, content}, {ipfsGateway: false})
  opts.beforeWrite?.(file)
  const destination = resolve(opts.dir, file)
  const preserved =
    opts.preserveSource && existsSync(destination) && markdownEquivalent(readFileSync(destination, 'utf8'), md)
  const changed = !preserved && writeIfChanged(destination, md)
  if (changed) opts.onWrite?.(file)
  ;(changed ? result.written : result.unchanged).push(file)
  log(`${changed ? 'wrote  ' : 'same   '} ${file}`)

  if (schemaCid && schemaFile) {
    const blob = await opts.client.request('GetCID', {cid: schemaCid})
    opts.beforeWrite?.(schemaFile)
    const changedSchema = writeJsonPreservingOrder(resolve(opts.dir, schemaFile), blob.value)
    if (changedSchema) opts.onWrite?.(schemaFile)
    ;(changedSchema ? result.written : result.unchanged).push(schemaFile)
    log(`${changedSchema ? 'wrote  ' : 'same   '} ${schemaFile}`)
  }
  return result
}

export async function exportSpace(opts: ExportOptions): Promise<ExportResult> {
  const result = emptyExportResult()
  const docs = await listSpaceDocuments(opts.client, opts.uid)
  await mapPool(docs, CONCURRENCY, (doc) => exportDocument(opts, doc, result))
  return result
}

/** Export the document at one path: the files written, and the markdown file it maps to. */
export async function exportPath(opts: ExportOptions, path: string): Promise<{written: string[]; file: string | null}> {
  const res = await opts.client.request(
    'Resource',
    hmId(opts.uid, {path: path ? path.replace(/^\//, '').split('/') : []}),
  )
  if (res.type !== 'document') return {written: [], file: null}
  const result = await exportDocument(opts, res.document)
  return {written: result.written, file: result.files.get(path) ?? null}
}

/** Current version of every document in a space, by path ('' = home). One Query + one Resource call. */
export async function listSpaceVersions(client: SeedClient, uid: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  const home = await client.request('Resource', hmId(uid))
  if (home.type === 'document') versions.set('', home.document.version)
  const query = await client.request('Query', {includes: [{space: uid, path: '', mode: 'AllDescendants'}]})
  for (const info of query?.results || []) {
    if (info.type !== 'document') continue
    versions.set('/' + info.path.join('/'), info.version)
  }
  return versions
}

// ─── Writers ─────────────────────────────────────────────────────────────────

/**
 * Give every other account WRITER access to the space, so any of the keys in
 * the local daemon can edit the dev site in the app. Idempotent: accounts that
 * already hold a space-wide WRITER capability are skipped.
 */
export async function grantWriters(
  opts: {client: SeedClient; signer: HMSigner; account: string; log?: (line: string) => void},
  accounts: Array<{name: string; publicKey: string}>,
): Promise<string[]> {
  const log = opts.log || (() => {})
  const existing = await opts.client.request('ListCapabilities', {targetId: hmId(opts.account)})
  const writers = new Set(
    (existing.capabilities || []).filter((c) => c.role === 'WRITER' && !c.path).map((c) => c.delegate),
  )
  const granted: string[] = []
  for (const {name, publicKey} of accounts) {
    if (publicKey === opts.account || writers.has(publicKey)) continue
    await opts.client.publish(await createCapability({delegateUid: publicKey, role: 'WRITER'}, opts.signer))
    log(`writer  ${name} (${publicKey})`)
    granted.push(publicKey)
  }
  return granted
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

/** A schema file beside a document: the type that document DEFINES (`schemaDefinition: ipfs://<cid>`). */
export type SchemaFile = {kind: 'type'; cid: string; data: Uint8Array}

/** Canonical DAG-CBOR encoding of a schema object and its CID (v1, sha2-256, dag-cbor). */
export async function encodeSchemaBlob(obj: unknown): Promise<{data: Uint8Array; cid: string}> {
  const data = dagCbor.encode(obj)
  const hash = await sha256.digest(data)
  return {data: new Uint8Array(data), cid: CID.create(1, dagCbor.code, hash).toString()}
}

/** The schema file beside a markdown file, when the layout maps one and it exists. */
export async function readSchemaFile(dir: string, mdFile: string, layout: SpaceLayout): Promise<SchemaFile | null> {
  const schemaFile = layout.schemaFileFor(mdFile)
  if (!schemaFile) return null
  const full = resolve(dir, schemaFile)
  if (!existsSync(full)) return null
  const obj = JSON.parse(readFileSync(full, 'utf8')) as Record<string, unknown> | null
  const {data, cid} = await encodeSchemaBlob(obj)
  return {kind: 'type', cid, data}
}

/** The metadata a schema file implies for its document. */
export function applySchemaMetadata(metadata: HMMetadata, schema: SchemaFile | null): HMMetadata {
  const raw = metadata as Record<string, unknown>
  // `schema` is the old name of the attributes binding; a document still carrying it loses it here.
  if (!schema && !('schema' in raw)) return metadata
  const out = {...raw}
  delete out.schema
  if (schema) out.schemaDefinition = `ipfs://${schema.cid}`
  return out as HMMetadata
}

// ─── Retire ──────────────────────────────────────────────────────────────────

export type RetireOptions = {
  client: SeedClient
  signer: HMSigner
  account: string
  dir: string
  layout?: SpaceLayout
  dryRun?: boolean
  /** Only these document paths are candidates; by default every document of the space. */
  paths?: string[]
  /** Paths to leave alone (e.g. the sources of moves the import just published). */
  skip?: ReadonlySet<string>
  /** A live path a retired document should redirect to instead of being deleted. */
  redirectFor?: (path: string, published: ReadonlySet<string>) => string | null
  log?: (line: string) => void
}

/**
 * Retire the documents of a space that no longer have a file in the directory: the directory is the truth about
 * what the space publishes. A document becomes a redirect when `redirectFor` names a live path, and is
 * tombstoned otherwise. The home document is never retired, and redirects are left alone. Returns the paths.
 */
export async function retireMissing(opts: RetireOptions): Promise<string[]> {
  const layout = opts.layout || defaultLayout
  const log = opts.log || (() => {})
  const published = new Set(
    listMarkdownFiles(opts.dir)
      .map((file) => layout.pathForFile(file))
      .filter((p): p is string => p !== null),
  )
  const candidates = opts.paths ?? [...(await listSpaceVersions(opts.client, opts.account)).keys()]
  const stale = candidates.filter((path) => path !== '' && !published.has(path) && !opts.skip?.has(path)).sort()
  const retired: string[] = []
  for (const path of stale) {
    const resource = await opts.client.request(
      'Resource',
      hmId(opts.account, {path: path.replace(/^\//, '').split('/')}),
    )
    if (resource.type !== 'document') continue
    const redirectTo = opts.redirectFor?.(path, published) ?? null
    log(redirectTo ? `redirect ${path} -> ${redirectTo}` : `retire  ${path}`)
    retired.push(path)
    if (opts.dryRun) continue
    const genesis = resource.document.genesis
    const ref = redirectTo
      ? await createRedirectRef(
          {
            space: opts.account,
            path,
            genesis,
            generation: Date.now(),
            targetSpace: opts.account,
            targetPath: redirectTo,
          },
          opts.signer,
        )
      : await createTombstoneRef(
          {
            space: opts.account,
            path,
            genesis,
            generation: resource.document.generationInfo ? Number(resource.document.generationInfo.generation) : 0,
          },
          opts.signer,
        )
    await opts.client.publish(ref)
  }
  return retired
}

// ─── Import ──────────────────────────────────────────────────────────────────

export type ImportOptions = {
  client: SeedClient
  signer: HMSigner
  /** The space (account uid) to publish into. */
  account: string
  dir: string
  layout?: SpaceLayout
  dryRun?: boolean
  /** Capability CID when the signer is not the space owner. */
  capability?: string
  /** Adjust a file's metadata before publishing (e.g. inject schema bindings). */
  metadataFor?: (file: string, metadata: HMMetadata) => HMMetadata
  /**
   * Old paths a new path is known to have moved from (e.g. from an alias table), most likely first.
   * When the block ids of a file don't identify its source, the first of these that still holds a
   * document, and has no file of its own, is published as a move instead of a new document.
   */
  movedFromFor?: (path: string) => string[]
  /** Restrict to these files (relative to dir). */
  only?: string[]
  /** Validate every document against its effective schema first; refuse to publish on a violation. */
  check?: boolean
  log?: (line: string) => void
}

export type SchemaViolation = {file: string; path: string; schema: string; via: 'own' | 'inherited'; errors: string[]}

/**
 * Every document in `files` that would violate its effective schema once published: its own
 * `schema`, else the `childrenSchema` of its parent — the parent file in the directory when
 * there is one, else the parent document on the site. A schema that cannot be resolved is
 * reported as a violation too: a typed document whose type is unreachable is not known to
 * conform. Advisory by nature (see typed-documents.md); `--check` turns it into a gate.
 */
export async function checkSchemas(
  opts: ImportOptions,
  files?: string[],
  prepared: Map<string, ReturnType<typeof prepareFile>> = new Map(),
): Promise<SchemaViolation[]> {
  const layout = opts.layout || defaultLayout
  const all = listMarkdownFiles(opts.dir)
  const targets = files ?? all
  const metadataOf = new Map<string, Record<string, unknown>>()
  const fileOfPath = new Map<string, string>()
  for (const file of all) {
    const p = layout.pathForFile(file)
    if (p !== null) fileOfPath.set(p, file)
  }
  for (const file of all) {
    let prep = prepared.get(file)
    if (!prep) prepared.set(file, (prep = prepareFile(opts, layout, file)))
    const schema = await readSchemaFile(opts.dir, file, layout)
    metadataOf.set(file, applySchemaMetadata(prep.metadata, schema) as Record<string, unknown>)
  }
  const out: SchemaViolation[] = []
  for (const file of targets) {
    const path = layout.pathForFile(file)
    if (path === null) continue
    const metadata = metadataOf.get(file) ?? {}
    let ref: string | null = typeof metadata.attributesSchema === 'string' ? metadata.attributesSchema : null
    let via: 'own' | 'inherited' = 'own'
    if (!ref && path) {
      const parentPath = path.replace(/\/[^/]+$/, '')
      const parentFile = fileOfPath.get(parentPath)
      const parentMeta = parentFile ? metadataOf.get(parentFile) : undefined
      if (parentMeta && typeof parentMeta.childAttributesSchema === 'string') {
        ref = parentMeta.childAttributesSchema
        via = 'inherited'
      } else {
        const id = hmId(opts.account, {path: path.replace(/^\//, '').split('/')})
        const effective = await effectiveSchemaRef(opts.client, id, metadata).catch(() => null)
        if (effective?.ref && effective.source !== 'none') {
          ref = effective.ref
          via = effective.source
        }
      }
    }
    if (!ref) continue
    try {
      const loaded = await loadSchema(opts.client, ref)
      const errors = metadataViolations(loaded.schema, metadata, loaded.registry)
      if (errors.length) out.push({file, path, schema: ref, via, errors})
    } catch (error) {
      out.push({file, path, schema: ref, via, errors: [(error as Error).message]})
    }
  }
  return out
}

export type ImportResult = {
  created: string[]
  updated: string[]
  unchanged: string[]
  skipped: string[]
  /** Documents moved to a new path, as `from -> to`. */
  moved: string[]
}

// ─── Move detection ──────────────────────────────────────────────────────────
//
// Block ids travel with the file, so a file whose ids belong to a document at
// another path is that document, renamed or moved. A move keeps the history:
// a Version Ref at the destination points at the current version, and a
// Redirect Ref at the source keeps old links resolving — the same two blobs
// `seed-cli document move` publishes.

/** Where every block id of a space lives: block id → document path. */
export type BlockIndex = {byBlock: Map<string, string>; docs: Map<string, HMDocument>}

export async function buildBlockIndex(client: SeedClient, uid: string): Promise<BlockIndex> {
  const byBlock = new Map<string, string>()
  const docs = new Map<string, HMDocument>()
  for (const doc of await listSpaceDocuments(client, uid)) {
    const path = doc.path || ''
    docs.set(path, doc)
    const walk = (nodes: HMBlockNode[] | undefined) => {
      for (const n of nodes || []) {
        byBlock.set((n.block as {id: string}).id, path)
        walk(n.children)
      }
    }
    walk(doc.content)
  }
  return {byBlock, docs}
}

/**
 * The path a file's blocks came from, when a majority of its explicit ids
 * belong to one document; null otherwise (a new document, or a hand-written
 * file with no ids).
 */
export function findMovedFrom(byBlock: Map<string, string>, blockIds: string[]): string | null {
  const tally = new Map<string, number>()
  for (const id of blockIds) {
    const path = byBlock.get(id)
    if (path !== undefined) tally.set(path, (tally.get(path) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [path, count] of tally) {
    if (count > bestCount) {
      best = path
      bestCount = count
    }
  }
  return bestCount > 0 && bestCount * 2 > blockIds.length ? best : null
}

/** Block ids the file states explicitly (an id comment in the source, not a generated one). */
function explicitBlockIds(raw: string, tree: BlockNode[]): string[] {
  const ids: string[] = []
  const walk = (nodes: BlockNode[]) => {
    for (const n of nodes) {
      if (raw.includes(`<!-- id:${n.block.id}`)) ids.push(n.block.id)
      walk(n.children)
    }
  }
  walk(tree)
  return ids
}

/** Publish a move: Version Ref at `to`, Redirect Ref at `from`. */
async function publishMove(opts: ImportOptions, from: string, to: string, doc: HMDocument) {
  const genesis = (doc as {generationInfo?: {genesis?: string}}).generationInfo?.genesis ?? doc.genesis
  const dest = await createVersionRef(
    {space: opts.account, path: to, genesis, version: doc.version, generation: Date.now(), capability: opts.capability},
    opts.signer,
  )
  await opts.client.publish(dest)
  const redirect = await createRedirectRef(
    {
      space: opts.account,
      path: from,
      genesis,
      generation: Date.now(),
      targetSpace: opts.account,
      targetPath: to,
      capability: opts.capability,
    },
    opts.signer,
  )
  await opts.client.publish(redirect)
}

/** All markdown files under `dir`, relative, sorted. */
export function listMarkdownFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith('.') && entry !== 'node_modules') walk(full)
      } else if (entry.endsWith('.md')) {
        out.push(relative(dir, full))
      }
    }
  }
  walk(dir)
  return out
}

/** A frontmatter value that names a file beside the page: an explicit relative path, never a bare name. */
const ASSET_PATH = /^\.\.?\//

type AssetLeaf = {key: string[]; value: string; abs: string}

/** The relative-path leaves of a page's frontmatter, resolved against the page's folder. */
function assetLeaves(dir: string, mdFile: string, metadata: Record<string, unknown> | undefined): AssetLeaf[] {
  const fileDir = resolve(dir, dirname(mdFile))
  return metadataLeaves(metadata)
    .filter((leaf): leaf is Leaf & {value: string} => typeof leaf.value === 'string' && ASSET_PATH.test(leaf.value))
    .map((leaf) => ({key: leaf.key, value: leaf.value, abs: resolve(fileDir, leaf.value)}))
}

/** `metadata` with one leaf replaced, the objects along the path copied. */
function withLeaf(metadata: Record<string, unknown>, key: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = key
  if (head === undefined) return metadata
  const child = metadata[head]
  return {
    ...metadata,
    [head]: rest.length
      ? withLeaf(child && typeof child === 'object' ? (child as Record<string, unknown>) : {}, rest, value)
      : value,
  }
}

/** The files of a folder on disk as the folder encoder takes them, dotfiles and `node_modules` left out. */
function folderFiles(root: string): Array<{path: string; content: Uint8Array}> {
  const out: Array<{path: string; content: Uint8Array}> = []
  const walk = (folder: string, prefix: string) => {
    for (const entry of readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(folder, entry.name), path)
      else if (entry.isFile()) out.push({path, content: readFileSync(join(folder, entry.name))})
    }
  }
  walk(root, '')
  return out
}

/**
 * A file or folder encoded as the blob an attribute references: a folder is a UnixFS directory, a
 * `.json` file a DAG-CBOR object (a JSON Schema, say), any other file a UnixFS file. The encoders
 * are the daemon's and the app's, so the CID is a function of the content alone, and export can
 * recompute it to tell an unchanged file from one edited in the app.
 */
export async function encodeAttributeAsset(abs: string): Promise<{cid: string; blobs: CollectedBlob[]}> {
  if (statSync(abs).isDirectory()) return directoryToIpfsBlobs(folderFiles(abs))
  if (abs.endsWith('.json')) {
    const {data, cid} = await encodeSchemaBlob(JSON.parse(readFileSync(abs, 'utf8')))
    return {cid, blobs: [{cid, data}]}
  }
  return fileToIpfsBlobs(readFileSync(abs))
}

/**
 * The files and folders a page's frontmatter names by relative path (`code: ./convert.ts`), each
 * published as the blob the attribute references. The metadata comes back with those leaves
 * replaced by `ipfs://<cid>` and the blobs ride with the change; the files stay the authority,
 * and restoreAttributeAssets is the way back. A path that names nothing is left alone: checkLinks
 * reports it, and nothing is published.
 */
export async function readAttributeAssets(
  dir: string,
  mdFile: string,
  metadata: HMMetadata,
): Promise<{metadata: HMMetadata; blobs: CollectedBlob[]}> {
  let out = metadata as Record<string, unknown>
  const blobs: CollectedBlob[] = []
  for (const leaf of assetLeaves(dir, mdFile, out)) {
    if (!existsSync(leaf.abs)) continue
    const encoded = await encodeAttributeAsset(leaf.abs)
    blobs.push(...encoded.blobs)
    out = withLeaf(out, leaf.key, `ipfs://${encoded.cid}`)
  }
  return {metadata: out as HMMetadata, blobs}
}

/** The attribute paths of a page that name no file, reported like broken links so nothing is published half-made. */
export function missingAttributeAssets(dir: string, mdFile: string, metadata: HMMetadata): BrokenLink[] {
  return assetLeaves(dir, mdFile, metadata as Record<string, unknown>)
    .filter((leaf) => !existsSync(leaf.abs))
    .map((leaf) => ({file: mdFile, link: leaf.value, reason: `${leaf.key.join('.')} names no file beside the page`}))
}

const RAW_CODEC = 0x55
const DAG_PB_CODEC = 0x70

/** The bytes of a dag-json bytes envelope (`{"/": {"bytes": "<base64>"}}`), the way the daemon renders a raw block. */
function dagJsonBytes(value: unknown): Uint8Array | null {
  const envelope = isObject(value) && isObject(value['/']) ? value['/'] : null
  return envelope && typeof envelope.bytes === 'string' ? new Uint8Array(Buffer.from(envelope.bytes, 'base64')) : null
}

/**
 * Writes the blob a CID names where an attribute asset lives: a DAG-CBOR object as JSON, a raw
 * block as the file's bytes, a UnixFS folder as a directory with exactly the entries the folder
 * lists (local files it does not list are removed).
 */
async function writeAttributeAsset(client: SeedClient, cid: string, abs: string): Promise<void> {
  const code = CID.parse(cid).code
  const {value} = await client.request('GetCID', {cid})
  if (code === DAG_PB_CODEC) {
    const links = isObject(value) && Array.isArray(value.Links) ? value.Links : null
    if (!links) throw new Error(`ipfs://${cid} is not a folder`)
    mkdirSync(abs, {recursive: true})
    const names = new Set<string>()
    for (const link of links) {
      const name = isObject(link) && typeof link.Name === 'string' ? link.Name : ''
      const child = isObject(link) && isObject(link.Hash) && typeof link.Hash['/'] === 'string' ? link.Hash['/'] : ''
      if (!name || !child || name === '.' || name === '..' || name.includes('/')) {
        throw new Error(`ipfs://${cid} has an entry that cannot be a file: ${name || child}`)
      }
      names.add(name)
      await writeAttributeAsset(client, child, join(abs, name))
    }
    for (const entry of readdirSync(abs)) {
      if (!names.has(entry) && !entry.startsWith('.')) rmSync(join(abs, entry), {recursive: true, force: true})
    }
    return
  }
  mkdirSync(dirname(abs), {recursive: true})
  if (code === RAW_CODEC) {
    const bytes = dagJsonBytes(value)
    if (!bytes) throw new Error(`ipfs://${cid} did not come back as bytes`)
    writeFileSync(abs, bytes)
    return
  }
  writeJsonPreservingOrder(abs, value)
}

/**
 * The way back for attribute assets: for each leaf the local page's frontmatter names by relative
 * path whose published value is `ipfs://<cid>`, the path keeps its place in the frontmatter, and
 * the file is written from the blob only when its content no longer encodes to that CID (an edit
 * made in the app). Without a local page there is nothing to map to, and the `ipfs://` stays.
 */
export async function restoreAttributeAssets(
  client: SeedClient,
  dir: string,
  mdFile: string,
  metadata: HMMetadata,
  hooks: {beforeWrite?: (file: string) => void; onWrite?: (file: string) => void; log?: (line: string) => void} = {},
): Promise<{metadata: HMMetadata; written: string[]; unchanged: string[]}> {
  const written: string[] = []
  const unchanged: string[] = []
  const local = resolve(dir, mdFile)
  if (!existsSync(local)) return {metadata, written, unchanged}
  let localMetadata: Record<string, unknown>
  try {
    localMetadata = parseMarkdown(readFileSync(local, 'utf8')).metadata as Record<string, unknown>
  } catch {
    return {metadata, written, unchanged}
  }
  let out = metadata as Record<string, unknown>
  const published = new Map(metadataLeaves(out).map((leaf) => [JSON.stringify(leaf.key), leaf.value]))
  for (const leaf of assetLeaves(dir, mdFile, localMetadata)) {
    const cid = ipfsCid(published.get(JSON.stringify(leaf.key)))
    if (!cid) continue
    const file = relative(dir, leaf.abs).split('\\').join('/')
    const current = existsSync(leaf.abs) ? (await encodeAttributeAsset(leaf.abs)).cid : null
    if (current !== cid) {
      hooks.beforeWrite?.(file)
      await writeAttributeAsset(client, cid, leaf.abs)
      hooks.onWrite?.(file)
      written.push(file)
    } else unchanged.push(file)
    hooks.log?.(`${current !== cid ? 'wrote  ' : 'same   '} ${file}`)
    out = withLeaf(out, leaf.key, leaf.value)
  }
  return {metadata: out as HMMetadata, written, unchanged}
}

type Leaf = {key: string[]; value: string | number | boolean | null}

/** Flatten metadata to attribute leaves, the shape SetAttributes takes. */
function metadataLeaves(metadata: Record<string, unknown> | undefined, prefix: string[] = []): Leaf[] {
  const out: Leaf[] = []
  for (const [k, v] of Object.entries(metadata || {})) {
    if (v === undefined) continue
    const key = [...prefix, k]
    if (v !== null && typeof v === 'object') out.push(...metadataLeaves(v as Record<string, unknown>, key))
    else if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
      out.push({key, value: v})
  }
  return out
}

/**
 * The SetAttributes op turning `oldMetadata` into `newMetadata`: changed and
 * added leaves are set, and leaves missing from the new metadata are nulled,
 * unless `keepUnlisted` asks to leave them alone. The home document asks: it is
 * also the space's own record, where the desktop keeps settings the directory
 * never names, such as `agentServerUrl` and `spaceAgents`, and a full import
 * used to wipe them. On the home document the file sets what it names, and a
 * key is removed by naming it with a null.
 */
export function metadataDiffOp(
  oldMetadata: Record<string, unknown> | undefined,
  newMetadata: Record<string, unknown> | undefined,
  options: {keepUnlisted?: boolean} = {},
): DocumentOperation | null {
  const oldLeaves = new Map(metadataLeaves(oldMetadata).map((l) => [l.key.join(' '), l.value]))
  const attrs: Leaf[] = []
  const seen = new Set<string>()
  for (const leaf of metadataLeaves(newMetadata)) {
    const k = leaf.key.join(' ')
    seen.add(k)
    if (!oldLeaves.has(k) || oldLeaves.get(k) !== leaf.value) attrs.push(leaf)
  }
  if (!options.keepUnlisted) {
    for (const [k] of oldLeaves) {
      if (!seen.has(k)) attrs.push({key: k.split(' '), value: null})
    }
  }
  return attrs.length ? {type: 'SetAttributes', attrs} : null
}

/** A file parsed and its links rewritten for `account`: what the import publishes. */
function prepareFile(opts: ImportOptions, layout: SpaceLayout, file: string) {
  const raw = readFileSync(resolve(opts.dir, file), 'utf8')
  const {tree, metadata} = parseMarkdown(raw)
  const blocks = markdownBlockNodesToHMBlockNodes(tree)
  const own = layout.selfAuthority
    ? rewriteLinks(blocks, (link) => swapAuthority(link, layout.selfAuthority!, opts.account))
    : blocks
  const nodes = relativeAssetsToFileLinks(relativeToHmLinks(own, file, opts.account, layout), opts.dir, file)
  return {raw, tree, metadata, nodes}
}

/**
 * Every link in `files` that would be broken once published (see
 * findBrokenLinks), against the set of paths the whole directory publishes.
 */
export function checkLinks(
  opts: ImportOptions,
  files?: string[],
  prepared: Map<string, ReturnType<typeof prepareFile>> = new Map(),
): BrokenLink[] {
  const layout = opts.layout || defaultLayout
  const all = listMarkdownFiles(opts.dir)
  const publishedPaths = new Set<string>()
  for (const f of all) {
    const p = layout.pathForFile(f)
    if (p !== null) publishedPaths.add(p)
  }
  const broken: BrokenLink[] = []
  for (const file of files ?? all) {
    if (layout.pathForFile(file) === null) continue
    let prep = prepared.get(file)
    if (!prep) prepared.set(file, (prep = prepareFile(opts, layout, file)))
    broken.push(...findBrokenLinks(file, prep.nodes, opts.account, publishedPaths))
    broken.push(...missingAttributeAssets(opts.dir, file, prep.metadata))
  }
  return broken
}

export async function importSpace(opts: ImportOptions): Promise<ImportResult> {
  const layout = opts.layout || defaultLayout
  const log = opts.log || (() => {})
  const result: ImportResult = {created: [], updated: [], unchanged: [], skipped: [], moved: []}
  // Each existing document moves to at most one new path.
  const claimedSources = new Set<string>()
  const files = opts.only ?? listMarkdownFiles(opts.dir)
  const allFiles = new Set(listMarkdownFiles(opts.dir))
  let index: Promise<BlockIndex> | undefined

  // Nothing is published while a link would break.
  const prepared = new Map<string, ReturnType<typeof prepareFile>>()
  const broken = checkLinks(opts, files, prepared)
  if (broken.length) {
    const lines = broken.slice(0, 50).map((b) => `  ${b.file}: ${b.link}  (${b.reason})`)
    if (broken.length > 50) lines.push(`  … and ${broken.length - 50} more`)
    throw new Error(
      `${broken.length} broken link${broken.length === 1 ? '' : 's'} in ${opts.dir}:\n${lines.join('\n')}`,
    )
  }
  // With --check, nothing is published while a document would violate its schema either.
  if (opts.check) {
    const bad = await checkSchemas(opts, files, prepared)
    if (bad.length) {
      const lines = bad.flatMap((v) => [`  ${v.file} (${v.schema}, ${v.via}):`, ...v.errors.map((e) => `    ✗ ${e}`)])
      throw new Error(
        `${bad.length} document${bad.length === 1 ? '' : 's'} in ${opts.dir} would violate a schema:\n${lines.join(
          '\n',
        )}`,
      )
    }
    log(`schema check passed for ${(files ?? listMarkdownFiles(opts.dir)).length} files`)
  }

  const processFile = async (file: string) => {
    const path = layout.pathForFile(file)
    if (path === null) {
      result.skipped.push(file)
      return
    }
    let prep = prepared.get(file)
    if (!prep) prepared.set(file, (prep = prepareFile(opts, layout, file)))
    const {raw, tree, metadata: fileMetadata, nodes} = prep
    await assertValidMermaid(nodes, await loadMermaidParser())
    const schema = await readSchemaFile(opts.dir, file, layout)
    const ownMetadata = layout.selfAuthority
      ? swapAuthority(fileMetadata, layout.selfAuthority, opts.account)
      : fileMetadata
    // The files the frontmatter names become the blobs its attributes reference.
    const assets = await readAttributeAssets(
      opts.dir,
      file,
      applySchemaMetadata(opts.metadataFor ? opts.metadataFor(file, ownMetadata) : ownMetadata, schema),
    )
    const metadata = assets.metadata
    // The schema blob and the attribute assets ride along with the change that binds them.
    const schemaBlobs = [...(schema ? [{data: schema.data, cid: schema.cid}] : []), ...assets.blobs]
    const resolved = await resolveFileLinks(nodes)
    const newTree = resolved.nodes.map(hmBlockNodeToBlockNode)
    const id = hmId(opts.account, {path: path ? path.replace(/^\//, '').split('/') : []})

    const existing = await opts.client.request('Resource', id)
    const label = path || '(home)'
    // The directory is the truth about what lives at a path: a deleted document
    // (tombstone) or a redirect there is replaced by a fresh one. The new Ref's
    // generation is later than theirs, which is what takes the path over.
    const absent = existing.type === 'not-found' || existing.type === 'tombstone' || existing.type === 'redirect'

    let movedFrom: string | null = null
    if (absent) {
      // No document here yet: a rename/move of an existing one, or a new one.
      const ids = explicitBlockIds(raw, tree)
      if (ids.length) {
        index ??= buildBlockIndex(opts.client, opts.account)
        const {byBlock, docs} = await index
        const from = findMovedFrom(byBlock, ids)
        // A copy (the source file still exists) is a new document, not a move.
        const sourceDoc = from === null ? undefined : docs.get(from)
        const sourceFile = sourceDoc ? layout.fileForPath(from!, sourceDoc) : null
        if (from !== null && !(sourceFile && allFiles.has(sourceFile)) && !claimedSources.has(from)) movedFrom = from
      }
      if (movedFrom === null && opts.movedFromFor) {
        index ??= buildBlockIndex(opts.client, opts.account)
        const {docs} = await index
        for (const candidate of opts.movedFromFor(path)) {
          const sourceDoc = docs.get(candidate)
          if (!sourceDoc || claimedSources.has(candidate)) continue
          const sourceFile = layout.fileForPath(candidate, sourceDoc)
          if (sourceFile && allFiles.has(sourceFile)) continue
          movedFrom = candidate
          break
        }
      }
      if (movedFrom !== null) claimedSources.add(movedFrom)
    }

    if (absent && movedFrom === null) {
      const ops: DocumentOperation[] = []
      const metaOp = metadataDiffOp(undefined, metadata as Record<string, unknown>)
      if (metaOp) ops.push(metaOp)
      ops.push(...flattenToOperations(newTree))
      log(`create  ${label}  (${file})`)
      result.created.push(file)
      if (opts.dryRun) return
      const {unsignedBytes, ts} = createChangeOps({ops})
      const changeBlock = await createChange(unsignedBytes, opts.signer)
      const ref = await createVersionRef(
        {
          space: opts.account,
          path,
          genesis: changeBlock.cid.toString(),
          version: changeBlock.cid.toString(),
          generation: Number(ts),
          capability: opts.capability,
        },
        opts.signer,
      )
      await opts.client.publish({
        blobs: [
          {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
          ...ref.blobs,
          ...schemaBlobs,
          ...resolved.blobs.map((b) => ({data: b.data, cid: b.cid})),
        ],
      })
      return
    }

    const baseId =
      movedFrom === null ? id : hmId(opts.account, {path: movedFrom ? movedFrom.replace(/^\//, '').split('/') : []})
    // The Resource call already returned the current document, which is all a
    // diff needs. The editable state (genesis, heads, depth) costs a fetch of
    // the whole change history, so it is resolved only to publish — which for
    // an unchanged document never happens.
    let base: Awaited<ReturnType<typeof resolveEditableDocument>> | undefined
    const getBase = async () => (base ??= await resolveEditableDocument(opts.client, baseId))
    if (movedFrom !== null) {
      log(`move    ${movedFrom || '(home)'} -> ${label}  (${file})`)
      result.moved.push(`${movedFrom} -> ${path}`)
      if (!opts.dryRun) await publishMove(opts, movedFrom, path, (await getBase()).document)
    }
    const oldDoc = movedFrom === null && existing.type === 'document' ? existing.document : (await getBase()).document
    const oldNodes = (oldDoc.content || []).map(toAPIBlockNode)
    const oldMap = createBlocksMap(oldNodes)
    // Match blocks without ids by position, even when other blocks in the
    // file have ids, so repeated imports do not replace those blocks. (An id is explicit
    // when its comment appears in the source; prose mentioning `<!-- id:X -->`
    // does not count.)
    const rebound = matchMarkdownIdentities(oldNodes, newTree, raw)
    const ops: DocumentOperation[] = computeReplaceOps(oldMap, rebound)
    const metaOp = metadataDiffOp(oldDoc.metadata as Record<string, unknown>, metadata as Record<string, unknown>, {
      keepUnlisted: path === '',
    })
    if (metaOp) ops.unshift(metaOp)

    if (ops.length === 0) {
      log(`same    ${label}`)
      result.unchanged.push(file)
      return
    }
    log(`update  ${label}  (${file}: ${ops.length} op${ops.length === 1 ? '' : 's'})`)
    result.updated.push(file)
    if (opts.dryRun) return

    const state = (await getBase()).state
    const {unsignedBytes, ts} = createChangeOps({
      ops,
      genesisCid: CID.parse(state.genesis),
      deps: state.heads.map((h) => CID.parse(h)),
      depth: state.headDepth + 1,
    })
    const changeBlock = await createChange(unsignedBytes, opts.signer)
    const ref = await createVersionRef(
      {
        space: opts.account,
        path,
        genesis: state.genesis,
        version: changeBlock.cid.toString(),
        generation: Number(ts),
        capability: opts.capability,
      },
      opts.signer,
    )
    await opts.client.publish({
      blobs: [
        {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
        ...ref.blobs,
        ...schemaBlobs,
        ...resolved.blobs.map((b) => ({data: b.data, cid: b.cid})),
      ],
    })
  }
  await mapPool(files, CONCURRENCY, processFile)
  return result
}
