/**
 * Space ⇄ directory sync: export every document of a space to markdown files
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
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, normalize, relative, resolve} from 'node:path'
import {
  blocksToMarkdown,
  createChange,
  createChangeOps,
  createVersionRef,
  flattenToOperations,
  markdownBlockNodesToHMBlockNodes,
  parseMarkdown,
  resolveEditableDocument,
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
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CID} from 'multiformats/cid'
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
    const m = /^(\.{1,2}\/[^#?]*\.md|[^:/#?][^#?]*\.md)(#.*)?$/.exec(link)
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
  result: ExportResult = {written: [], unchanged: [], skipped: []},
): Promise<ExportResult> {
  const layout = opts.layout || defaultLayout
  const log = opts.log || (() => {})
  const path = doc.path || ''
  const file = layout.fileForPath(path, doc)
  if (!file) {
    result.skipped.push(path || '(home)')
    return result
  }
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
  const result: ExportResult = {written: [], unchanged: [], skipped: []}
  const docs = await listSpaceDocuments(opts.client, opts.uid)
  for (const doc of docs) await exportDocument(opts, doc, result)
  return result
}

/** Export the document at one path; returns the files written. */
export async function exportPath(opts: ExportOptions, path: string): Promise<string[]> {
  const res = await opts.client.request(
    'Resource',
    hmId(opts.uid, {path: path ? path.replace(/^\//, '').split('/') : []}),
  )
  if (res.type !== 'document') return []
  const result = await exportDocument(opts, res.document)
  return result.written
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
  const result: ImportResult = {created: [], updated: [], unchanged: [], skipped: []}
  const files = opts.only ?? listMarkdownFiles(opts.dir)

  for (const file of files) {
    const path = layout.pathForFile(file)
    if (path === null) {
      result.skipped.push(file)
      continue
    }
    const raw = readFileSync(resolve(opts.dir, file), 'utf8')
    const {tree, metadata: fileMetadata} = parseMarkdown(raw)
    const metadata = opts.metadataFor ? opts.metadataFor(file, fileMetadata) : fileMetadata
    const resolved = await resolveFileLinks(
      relativeToHmLinks(markdownBlockNodesToHMBlockNodes(tree), file, opts.account, layout),
    )
    const newTree = resolved.nodes.map(hmBlockNodeToBlockNode)
    const id = hmId(opts.account, {path: path ? path.replace(/^\//, '').split('/') : []})

    const existing = await opts.client.request('Resource', id)
    const label = path || '(home)'

    if (existing.type === 'not-found') {
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
          ...resolved.blobs.map((b) => ({data: b.data, cid: b.cid})),
        ],
      })
      continue
    }

    const base = await resolveEditableDocument(opts.client, id)
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
        ...resolved.blobs.map((b) => ({data: b.data, cid: b.cid})),
      ],
    })
  }
  return result
}
