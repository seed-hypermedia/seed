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
 * document's `metadata.schemaDefinition` points at as `<file>.schema.json`;
 * import encodes that file back to canonical DAG-CBOR, publishes the blob with
 * the document, and sets `schemaDefinition: ipfs://<cid>` (the file is the
 * truth, whatever the frontmatter says). A `{$type, value}` file is an
 * instance, not a type: its document conforms to `$type` (`metadata.schema`).
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, normalize, relative, resolve} from 'node:path'
import {
  blocksToMarkdown,
  createCapability,
  createChange,
  createChangeOps,
  createRedirectRef,
  createVersionRef,
  flattenToOperations,
  markdownBlockNodesToHMBlockNodes,
  parseMarkdown,
  resolveEditableDocument,
  type BlockNode,
  type DocumentOperation,
  type HMSigner,
  type SeedClient,
} from '@seed-hypermedia/client'
import {
  computeReplaceOps,
  createBlocksMap,
  matchBlockIds,
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
  for (const info of query?.results || []) {
    if (info.type !== 'document') continue
    const res = await client.request('Resource', hmId(uid, {path: info.path}))
    if (res.type === 'document') docs.push(res.document)
  }
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
  const content = hmToRelativeLinks(doc.content || [], file, doc.account, layout)
  const md = blocksToMarkdown({...doc, content}, {ipfsGateway: false})
  const changed = writeIfChanged(resolve(opts.dir, file), md)
  ;(changed ? result.written : result.unchanged).push(file)
  log(`${changed ? 'wrote  ' : 'same   '} ${file}`)

  const schemaCid = ipfsCid((doc.metadata as Record<string, unknown> | undefined)?.schemaDefinition)
  const schemaFile = schemaCid ? layout.schemaFileFor(file) : null
  if (schemaCid && schemaFile) {
    const blob = await opts.client.request('GetCID', {cid: schemaCid})
    const changedSchema = writeJsonPreservingOrder(resolve(opts.dir, schemaFile), blob.value)
    ;(changedSchema ? result.written : result.unchanged).push(schemaFile)
    log(`${changedSchema ? 'wrote  ' : 'same   '} ${schemaFile}`)
  }
  return result
}

export async function exportSpace(opts: ExportOptions): Promise<ExportResult> {
  const result = emptyExportResult()
  const docs = await listSpaceDocuments(opts.client, opts.uid)
  for (const doc of docs) await exportDocument(opts, doc, result)
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

export type SchemaFile =
  /** A type: the document DEFINES this schema (`schemaDefinition: ipfs://<cid>`). */
  | {kind: 'type'; cid: string; data: Uint8Array}
  /** An instance (`{$type, value}`): the document CONFORMS to `$type` (`schema`). */
  | {kind: 'instance'; type: string}

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
  if (obj && typeof obj === 'object' && typeof obj.$type === 'string' && 'value' in obj) {
    return {kind: 'instance', type: obj.$type}
  }
  const {data, cid} = await encodeSchemaBlob(obj)
  return {kind: 'type', cid, data}
}

/** The metadata a schema file implies for its document. */
export function applySchemaMetadata(metadata: HMMetadata, schema: SchemaFile | null): HMMetadata {
  if (!schema) return metadata
  const out = {...(metadata as Record<string, unknown>)}
  if (schema.kind === 'instance') {
    out.schema = schema.type
    delete out.schemaDefinition
  } else {
    out.schemaDefinition = `ipfs://${schema.cid}`
  }
  return out as HMMetadata
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
  /** Restrict to these files (relative to dir). */
  only?: string[]
  log?: (line: string) => void
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
 * added leaves are set, leaves missing from the new metadata are nulled.
 */
export function metadataDiffOp(
  oldMetadata: Record<string, unknown> | undefined,
  newMetadata: Record<string, unknown> | undefined,
): DocumentOperation | null {
  const oldLeaves = new Map(metadataLeaves(oldMetadata).map((l) => [l.key.join(' '), l.value]))
  const attrs: Leaf[] = []
  const seen = new Set<string>()
  for (const leaf of metadataLeaves(newMetadata)) {
    const k = leaf.key.join(' ')
    seen.add(k)
    if (!oldLeaves.has(k) || oldLeaves.get(k) !== leaf.value) attrs.push(leaf)
  }
  for (const [k] of oldLeaves) {
    if (!seen.has(k)) attrs.push({key: k.split(' '), value: null})
  }
  return attrs.length ? {type: 'SetAttributes', attrs} : null
}

export async function importSpace(opts: ImportOptions): Promise<ImportResult> {
  const layout = opts.layout || defaultLayout
  const log = opts.log || (() => {})
  const result: ImportResult = {created: [], updated: [], unchanged: [], skipped: [], moved: []}
  const files = opts.only ?? listMarkdownFiles(opts.dir)
  const allFiles = new Set(listMarkdownFiles(opts.dir))
  let index: Promise<BlockIndex> | undefined

  for (const file of files) {
    const path = layout.pathForFile(file)
    if (path === null) {
      result.skipped.push(file)
      continue
    }
    const raw = readFileSync(resolve(opts.dir, file), 'utf8')
    const {tree, metadata: fileMetadata} = parseMarkdown(raw)
    const schema = await readSchemaFile(opts.dir, file, layout)
    const metadata = applySchemaMetadata(opts.metadataFor ? opts.metadataFor(file, fileMetadata) : fileMetadata, schema)
    // The schema blob rides along with the change that binds it.
    const schemaBlobs = schema?.kind === 'type' ? [{data: schema.data, cid: schema.cid}] : []
    const resolved = await resolveFileLinks(
      relativeToHmLinks(markdownBlockNodesToHMBlockNodes(tree), file, opts.account, layout),
    )
    const newTree = resolved.nodes.map(hmBlockNodeToBlockNode)
    const id = hmId(opts.account, {path: path ? path.replace(/^\//, '').split('/') : []})

    const existing = await opts.client.request('Resource', id)
    const label = path || '(home)'

    let movedFrom: string | null = null
    if (existing.type === 'not-found') {
      // No document here yet: a rename/move of an existing one, or a new one.
      const ids = explicitBlockIds(raw, tree)
      if (ids.length) {
        index ??= buildBlockIndex(opts.client, opts.account)
        const {byBlock, docs} = await index
        const from = findMovedFrom(byBlock, ids)
        // A copy (the source file still exists) is a new document, not a move.
        const sourceDoc = from === null ? undefined : docs.get(from)
        const sourceFile = sourceDoc ? layout.fileForPath(from!, sourceDoc) : null
        if (from !== null && !(sourceFile && allFiles.has(sourceFile))) movedFrom = from
      }
    }

    if (existing.type === 'not-found' && movedFrom === null) {
      const ops: DocumentOperation[] = []
      const metaOp = metadataDiffOp(undefined, metadata as Record<string, unknown>)
      if (metaOp) ops.push(metaOp)
      ops.push(...flattenToOperations(newTree))
      log(`create  ${label}  (${file})`)
      result.created.push(file)
      if (opts.dryRun) continue
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
      continue
    }

    const baseId =
      movedFrom === null ? id : hmId(opts.account, {path: movedFrom ? movedFrom.replace(/^\//, '').split('/') : []})
    const base = await resolveEditableDocument(opts.client, baseId)
    if (movedFrom !== null) {
      log(`move    ${movedFrom || '(home)'} -> ${label}  (${file})`)
      result.moved.push(`${movedFrom} -> ${path}`)
      if (!opts.dryRun) await publishMove(opts, movedFrom, path, base.document)
    }
    const oldDoc = base.document
    const oldNodes = (oldDoc.content || []).map(toAPIBlockNode)
    const oldMap = createBlocksMap(oldNodes)
    // A hand-written file carries no block ids: match its blocks to the
    // existing document by position, so edits update blocks in place instead
    // of replacing the whole document every time. (A block's id is explicit
    // when its comment appears in the source; prose mentioning `<!-- id:X -->`
    // does not count.)
    const hasIds = newTree.some((n) => raw.includes(`<!-- id:${n.block.id}`))
    const matched = hasIds ? newTree : matchBlockIds(oldNodes, newTree)
    const rebound = rebindTableIdentities(oldNodes, matched)
    const ops: DocumentOperation[] = computeReplaceOps(oldMap, rebound)
    const metaOp = metadataDiffOp(oldDoc.metadata as Record<string, unknown>, metadata as Record<string, unknown>)
    if (metaOp) ops.unshift(metaOp)

    if (ops.length === 0) {
      log(`same    ${label}`)
      result.unchanged.push(file)
      continue
    }
    log(`update  ${label}  (${file}: ${ops.length} op${ops.length === 1 ? '' : 's'})`)
    result.updated.push(file)
    if (opts.dryRun) continue

    const state = base.state
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
  return result
}
