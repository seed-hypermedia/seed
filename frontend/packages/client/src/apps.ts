/**
 * Apps and their children: documents typed `hm://hyper.media/app`, `hm://hyper.media/tool`,
 * `hm://hyper.media/page` and `hm://hyper.media/trigger`.
 *
 * An app lists its children (tools and custom HTML pages) as card embeds in its content, and every
 * child lives one path segment under the app. The embeds are the source of truth for which children
 * belong to the app and in what order. Agents, the CLI and the apps' own UI all go through the
 * helpers here, so the "every child is embedded" rule is enforced in one place.
 */

import {computeReplaceOps, createBlocksMap, hmBlockNodeToBlockNode, toAPIBlockNode} from './block-diff'
import {createChange, createChangeOps, type DocumentOperation} from './change'
import type {SeedClient} from './client'
import {resolveEditableDocument} from './document-state'
import type {CollectedBlob} from './file-to-ipfs'
import {hmIdPathToEntityQueryPath, packHmId, unpackHmId, type HMBlockNode, type UnpackedHypermediaId} from './hm-types'
import type {BlockNode} from './markdown-to-blocks'
import {createVersionRef} from './ref'
import type {AnySigner} from './signer'
import {CID} from 'multiformats/cid'
import {encodeDagCbor} from './signed-blob'

export const HM_APP_TYPE = 'hm://hyper.media/app'
export const HM_TOOL_TYPE = 'hm://hyper.media/tool'
export const HM_PAGE_TYPE = 'hm://hyper.media/page'
export const HM_AGENT_TYPE = 'hm://hyper.media/agent'
export const HM_TRIGGER_TYPE = 'hm://hyper.media/trigger'

/**
 * Documents that host tools and pages: apps and agents (the two are converging into one concept).
 * Both list their children as card embeds and run their tools the same way.
 */
export function isToolHostType(type: unknown): boolean {
  return type === HM_APP_TYPE || type === HM_AGENT_TYPE
}

/** The file a tool's code folder must contain: `export default async function (input) {…}`. */
export const TOOL_ENTRY_FILE = 'index.ts'

/** Starting code for a tool created without any. */
export const TOOL_CODE_TEMPLATE = `export default async function (input) {
  return {}
}
`

/** The kinds of children an app (or agent) endorses. */
export type AppChildKind = 'tool' | 'page' | 'trigger'

/** Which app child a document type is, or null for any other type. */
export function appChildKind(type: unknown): AppChildKind | null {
  if (type === HM_TOOL_TYPE) return 'tool'
  if (type === HM_PAGE_TYPE) return 'page'
  if (type === HM_TRIGGER_TYPE) return 'trigger'
  return null
}

/** One child an app lists: the embed block that lists it and the child's versionless id. */
export type AppEmbeddedChild = {blockId: string; id: UnpackedHypermediaId}

/**
 * The children an app lists, in content order: its top-level embeds. Only embeds whose target sits
 * directly under the app count, so an app cannot claim someone else's documents as its tools.
 */
export function appEmbeddedChildren(
  appId: UnpackedHypermediaId,
  content: HMBlockNode[] | undefined,
): AppEmbeddedChild[] {
  const children: AppEmbeddedChild[] = []
  const seen = new Set<string>()
  for (const node of content ?? []) {
    const block = node.block as {id?: string; type?: string; link?: string}
    if (block.type !== 'Embed' || !block.link || !block.id) continue
    const id = unpackHmId(block.link)
    if (!id || !isAppChildId(appId, id)) continue
    const key = packHmId(versionless(id))
    if (seen.has(key)) continue
    seen.add(key)
    children.push({blockId: block.id, id: versionless(id)})
  }
  return children
}

/** Whether `childId` is exactly one path segment under `appId`, in the same space. */
export function isAppChildId(appId: UnpackedHypermediaId, childId: UnpackedHypermediaId): boolean {
  const appPath = appId.path ?? []
  const childPath = childId.path ?? []
  return (
    childId.uid === appId.uid &&
    childPath.length === appPath.length + 1 &&
    appPath.every((segment, index) => childPath[index] === segment)
  )
}

/** The id of the document one path segment above `id`, or null for a space home. */
export function parentDocumentId(id: UnpackedHypermediaId): UnpackedHypermediaId | null {
  const path = id.path ?? []
  if (!path.length) return null
  const parentPath = path.slice(0, -1)
  return versionless({...id, path: parentPath.length ? parentPath : null})
}

/**
 * The ops that make an app list exactly `children`, in that order. Existing embeds of those
 * children keep their blocks (and ids); other app-child embeds are removed; anything else in the
 * content stays where it is, after the listed children.
 */
export function appChildrenOps(
  appId: UnpackedHypermediaId,
  content: HMBlockNode[] | undefined,
  children: UnpackedHypermediaId[],
): DocumentOperation[] {
  const oldNodes = (content ?? []).map((node) => toAPIBlockNode(node))
  const existing = new Map(appEmbeddedChildren(appId, content).map((child) => [packHmId(child.id), child.blockId]))
  const childBlockIds = new Set(existing.values())
  const listed: BlockNode[] = children.map((child) => {
    const id = versionless(child)
    const blockId = existing.get(packHmId(id)) ?? newBlockId()
    return {
      block: {
        type: 'Embed',
        id: blockId,
        text: '',
        annotations: [],
        link: packHmId(id),
        attributes: {view: 'Card'},
      },
      children: [],
    }
  })
  const rest = (content ?? [])
    .filter((node) => !childBlockIds.has((node.block as {id?: string}).id ?? ''))
    .map((node) => hmBlockNodeToBlockNode(node))
  return computeReplaceOps(createBlocksMap(oldNodes), [...listed, ...rest])
}

/** Ops that turn a document body from `before` into `after` (block ids kept where they match). */
export function replaceContentOps(before: HMBlockNode[] | undefined, after: HMBlockNode[]): DocumentOperation[] {
  return computeReplaceOps(
    createBlocksMap((before ?? []).map((node) => toAPIBlockNode(node))),
    after.map((node) => hmBlockNodeToBlockNode(node)),
  )
}

/** Ops that append `child` to an app's list, or none when it is already listed. */
export function addAppChildOps(
  appId: UnpackedHypermediaId,
  content: HMBlockNode[] | undefined,
  child: UnpackedHypermediaId,
): DocumentOperation[] {
  const listed = appEmbeddedChildren(appId, content).map((entry) => entry.id)
  if (listed.some((id) => packHmId(id) === packHmId(versionless(child)))) return []
  return appChildrenOps(appId, content, [...listed, child])
}

/** Ops that drop `child` from an app's list, or none when it is not listed. */
export function removeAppChildOps(
  appId: UnpackedHypermediaId,
  content: HMBlockNode[] | undefined,
  child: UnpackedHypermediaId,
): DocumentOperation[] {
  const listed = appEmbeddedChildren(appId, content).map((entry) => entry.id)
  const remaining = listed.filter((id) => packHmId(id) !== packHmId(versionless(child)))
  if (remaining.length === listed.length) return []
  return appChildrenOps(appId, content, remaining)
}

/**
 * Signs one change with `ops` on top of the document's current heads, plus the Version Ref that
 * makes it the latest version. Returns the blobs to publish (`extraBlobs`, such as a tool's code
 * folder, come last). `capability` is the writer capability when the signer writes into another
 * account's space.
 */
export async function createDocumentUpdateBlobs({
  client,
  signer,
  id,
  ops,
  capability,
  extraBlobs = [],
}: {
  client: Pick<SeedClient, 'request'>
  signer: AnySigner
  id: UnpackedHypermediaId
  ops: DocumentOperation[]
  capability?: string
  extraBlobs?: CollectedBlob[]
}): Promise<{blobs: CollectedBlob[]; targetId: UnpackedHypermediaId}> {
  if (!ops.length) throw new Error('No document changes to publish')
  const base = await resolveEditableDocument(client, id)
  const state = base.state
  const {unsignedBytes, ts} = createChangeOps({
    ops,
    genesisCid: CID.parse(state.genesis),
    deps: state.heads.map((head) => CID.parse(head)),
    depth: state.headDepth + 1,
  })
  const change = await createChange(unsignedBytes, signer)
  const ref = await createVersionRef(
    {
      space: base.targetId.uid,
      path: hmIdPathToEntityQueryPath(base.targetId.path),
      genesis: state.genesis,
      version: change.cid.toString(),
      generation: Number(ts),
      capability,
    },
    signer,
  )
  return {
    blobs: [
      {cid: change.cid.toString(), data: new Uint8Array(change.bytes)},
      ...ref.blobs.map((blob) => ({cid: blob.cid!, data: blob.data})),
      ...extraBlobs,
    ],
    targetId: base.targetId,
  }
}

function versionless(id: UnpackedHypermediaId): UnpackedHypermediaId {
  const path = id.path?.length ? id.path : null
  return {
    ...id,
    id: packHmId({...id, path, version: null, blockRef: null, blockRange: null, latest: true}),
    path,
    version: null,
    blockRef: null,
    blockRange: null,
    latest: true,
  }
}

function newBlockId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => alphabet[byte & 63]).join('')
}

/**
 * A trigger document (`type: hm://hyper.media/trigger`) is a child of an app or an agent, listed in
 * it as a card embed like a tool. Its metadata says when it fires and what it does:
 *
 * - `source`: `ipfs://<cid>` of a DAG-CBOR trigger source (activity conditions, a schedule, a
 *   webhook, or run-completed), the same shape agents' triggers have always used.
 * - `tool`: optionally the hm:// URL of one of its host's tools to call when it fires.
 * - `input`: optionally `ipfs://<cid>` of a DAG-CBOR input template for that tool; string values
 *   `"$event"` and `"$event.<path>"` are replaced from the event.
 * - `enabled`: `false` turns it off; any other value (or none) leaves it on.
 *
 * With no `tool`, a trigger under an agent starts a session with the agent and the trigger's body
 * (its content) is the first message. A trigger under an app must name a tool.
 */
export type TriggerDocumentFields = {
  /** The trigger source; published as a DAG-CBOR blob. */
  source: unknown
  /** hm:// URL of the host's tool to call, or null to start an agent session. */
  tool?: string | null
  /** Input template for the tool; published as a DAG-CBOR blob. */
  input?: unknown
  enabled?: boolean
}

/** A trigger document's metadata as stored: references to its source and input blobs. */
export type TriggerDocumentRefs = {
  sourceCid: string | null
  tool: string | null
  inputCid: string | null
  enabled: boolean
}

/** The CID inside an `ipfs://<cid>` reference (or a bare CID), or null. */
export function ipfsRefCid(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const cid = value.replace(/^ipfs:\/\//i, '').split('/')[0] ?? ''
  return cid || null
}

/** Reads a trigger document's metadata references. */
export function triggerDocumentRefs(metadata: Record<string, unknown> | undefined): TriggerDocumentRefs {
  return {
    sourceCid: ipfsRefCid(metadata?.source),
    tool: typeof metadata?.tool === 'string' && metadata.tool ? metadata.tool : null,
    inputCid: ipfsRefCid(metadata?.input),
    enabled: metadata?.enabled !== false && metadata?.enabled !== 'false',
  }
}

/**
 * The `SetAttributes` op that writes a trigger's fields, with the DAG-CBOR blobs it references
 * (publish them with the change). Fields left `undefined` are not touched; `tool: null` and
 * `input: null` clear them.
 */
export async function triggerDocumentOps(
  fields: Partial<TriggerDocumentFields>,
): Promise<{ops: DocumentOperation[]; blobs: CollectedBlob[]}> {
  const attrs: {key: string[]; value: string | boolean | null}[] = []
  const blobs: CollectedBlob[] = []
  if (fields.source !== undefined) {
    const encoded = await encodeDagCbor(fields.source)
    blobs.push({cid: encoded.cid, data: encoded.data})
    attrs.push({key: ['source'], value: `ipfs://${encoded.cid}`})
  }
  if (fields.tool !== undefined) attrs.push({key: ['tool'], value: fields.tool || null})
  if (fields.input !== undefined) {
    if (fields.input === null) attrs.push({key: ['input'], value: null})
    else {
      const encoded = await encodeDagCbor(fields.input)
      blobs.push({cid: encoded.cid, data: encoded.data})
      attrs.push({key: ['input'], value: `ipfs://${encoded.cid}`})
    }
  }
  if (fields.enabled !== undefined) attrs.push({key: ['enabled'], value: fields.enabled})
  return {ops: attrs.length ? [{type: 'SetAttributes', attrs}] : [], blobs}
}
