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
import type {DocumentOperation} from './change'
import type {SeedClient} from './client'
import {resolveEditableDocument} from './document-state'
import type {CollectedBlob} from './file-to-ipfs'
import {hmIdPathToEntityQueryPath, packHmId, unpackHmId, type HMBlockNode, type UnpackedHypermediaId} from './hm-types'
import type {BlockNode} from './markdown-to-blocks'
import {prepareDocumentUpdateBlobs} from './prepare-change'
import type {AnySigner} from './signer'

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
 *
 * The Change is computed by the daemon (`PrepareDocumentChange`, through
 * {@link prepareDocumentUpdateBlobs}), which leaves out every op that would change nothing. When
 * nothing is left, `changed` is false and `blobs` holds only `extraBlobs`: no Change and no Ref.
 * Publish `blobs` only when it is not empty.
 *
 * A redirected address is followed: the update lands on the document the address presents
 * (`targetId`).
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
}): Promise<{blobs: CollectedBlob[]; targetId: UnpackedHypermediaId; changed: boolean}> {
  if (!ops.length) throw new Error('No document changes to publish')
  const base = await resolveEditableDocument(client, id)
  const update = await prepareDocumentUpdateBlobs({
    client,
    signer,
    account: base.targetId.uid,
    path: hmIdPathToEntityQueryPath(base.targetId.path),
    baseVersion: base.state.version,
    ops,
    capability,
    genesis: base.state.genesis,
    currentGeneration: base.document.generationInfo?.generation,
  })
  return {blobs: [...update.blobs, ...extraBlobs], targetId: base.targetId, changed: update.changed}
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
 * it as a card embed like a tool. Its metadata holds the whole trigger, readable and editable in
 * place:
 *
 * - `source`: when it fires (activity conditions, a schedule, a webhook, or a run finishing).
 * - `tool`: optionally the hm:// URL of one of its host's tools to call when it fires.
 * - `input`: optionally the tool's input template; string values `"$event"` and `"$event.<path>"`
 *   are replaced from the event.
 * - `enabled`: `false` turns it off; any other value (or none) leaves it on.
 *
 * With no `tool`, a trigger under an agent starts a session with the agent and the trigger's body
 * (its content) is the first message. A trigger under an app calls one of the app's tools.
 *
 * Document attributes merge key by key, and a list is one value that can only be replaced whole, so
 * the source stores its sets as maps (see {@link triggerSourceToMetadata}): `daysOfWeek: {mon: true}`,
 * `timesOfDay: {"08:00": true}`, account lists as `{<account>: true}`, `eventTypes: {comment: true}`,
 * and `conditions` keyed by their ids. Each entry is then its own key, edited without touching the
 * others.
 */
export type TriggerDocumentFields = {
  /** The trigger source, in the engine's shape (lists); stored as maps. */
  source: unknown
  /** hm:// URL of the host's tool to call, or null to start an agent session. */
  tool?: string | null
  /** Input template for the tool. */
  input?: unknown
  enabled?: boolean
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** Source fields that are sets: stored as `{<item>: true}` maps. */
const SET_FIELDS = ['timesOfDay', 'mentionedAccounts', 'repliedToAccounts', 'documentAuthors', 'eventTypes']

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** A trigger source as document metadata: its lists as maps, so each entry is its own key. */
export function triggerSourceToMetadata(source: unknown): unknown {
  if (!isPlainRecord(source)) return source
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'daysOfWeek' && Array.isArray(value))
      out[key] = Object.fromEntries(value.map((day) => [DAY_NAMES[Number(day)] ?? String(day), true]))
    else if (SET_FIELDS.includes(key) && Array.isArray(value))
      out[key] = Object.fromEntries(value.map((item) => [String(item), true]))
    else if (key === 'conditions' && Array.isArray(value))
      out[key] = Object.fromEntries(
        value.map((condition, index) => {
          const {id, source: conditionSource} = (condition ?? {}) as {id?: unknown; source?: unknown}
          return [
            typeof id === 'string' && id ? id : `condition-${index + 1}`,
            triggerSourceToMetadata(conditionSource),
          ]
        }),
      )
    else out[key] = isPlainRecord(value) ? triggerSourceToMetadata(value) : value
  }
  return out
}

/** A trigger source read from document metadata, in the engine's shape. */
export function triggerSourceFromMetadata(metadata: unknown): unknown {
  if (!isPlainRecord(metadata)) return metadata
  const members = (value: unknown) =>
    isPlainRecord(value)
      ? Object.entries(value)
          .filter(([, on]) => on === true || on === 'true')
          .map(([item]) => item)
      : Array.isArray(value)
        ? value
        : []
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'daysOfWeek')
      out[key] = members(value)
        .map((day) => (typeof day === 'number' ? day : DAY_NAMES.indexOf(String(day).toLowerCase())))
        .filter((day) => day >= 0)
        .sort((a, b) => a - b)
    else if (SET_FIELDS.includes(key)) out[key] = key === 'timesOfDay' ? members(value).sort() : members(value)
    else if (key === 'conditions' && isPlainRecord(value))
      out[key] = Object.entries(value).map(([id, condition]) => ({id, source: triggerSourceFromMetadata(condition)}))
    else out[key] = isPlainRecord(value) ? triggerSourceFromMetadata(value) : value
  }
  return out
}

/** A trigger document's fields, read from its metadata. */
export function triggerDocumentFields(metadata: Record<string, unknown> | undefined): {
  source: unknown
  tool: string | null
  input: unknown
  enabled: boolean
} {
  return {
    source: isPlainRecord(metadata?.source) ? triggerSourceFromMetadata(metadata.source) : undefined,
    tool: typeof metadata?.tool === 'string' && metadata.tool ? metadata.tool : null,
    input: metadata?.input ?? undefined,
    enabled: metadata?.enabled !== false && metadata?.enabled !== 'false',
  }
}

/**
 * Attribute writes that set `value` at `key` one entry at a time (lists stay whole values), after
 * clearing `key`, so the result is exactly `value` with no entries left from what was there.
 */
function leafAttributes(key: string[], value: unknown): {key: string[]; value: unknown}[] {
  if (!isPlainRecord(value)) return [{key, value}]
  const leaves = Object.entries(value).flatMap(([child, childValue]) => leafAttributes([...key, child], childValue))
  return leaves
}

/**
 * The `SetAttributes` op that writes a trigger's fields into its document. Fields left `undefined`
 * are not touched; `tool: null` and `input: null` clear them. A field that is written replaces what
 * was there: it is cleared first, then set entry by entry.
 */
export async function triggerDocumentOps(
  fields: Partial<TriggerDocumentFields>,
): Promise<{ops: DocumentOperation[]; blobs: CollectedBlob[]}> {
  const attrs: {key: string[]; value: unknown}[] = []
  const replace = (key: string, value: unknown) => {
    attrs.push({key: [key], value: null})
    if (value !== null) attrs.push(...leafAttributes([key], value))
  }
  if (fields.source !== undefined) replace('source', triggerSourceToMetadata(fields.source))
  if (fields.tool !== undefined) attrs.push({key: ['tool'], value: fields.tool || null})
  if (fields.input !== undefined) replace('input', fields.input)
  if (fields.enabled !== undefined) attrs.push({key: ['enabled'], value: fields.enabled})
  return {
    ops: attrs.length ? [{type: 'SetAttributes', attrs: attrs as {key: string[]; value: string}[]}] : [],
    blobs: [],
  }
}
