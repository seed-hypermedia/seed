/**
 * Trigger documents (hypermedia/apps/triggers.md): a trigger is a document typed
 * `hm://hyper.media/trigger` under an app or an agent, listed by a card embed in its host like a
 * tool. This module reads a host's triggers from Hypermedia; the service projects them into its
 * trigger rows (the engine every trigger source and firing already runs on) while the host lives on
 * this server.
 */

import {
  appEmbeddedChildren,
  HM_TRIGGER_TYPE,
  isToolHostType,
  parentDocumentId,
  triggerDocumentRefs,
} from '@seed-hypermedia/client/apps'
import type {SeedClient} from '@seed-hypermedia/client'
import {unpackHmId, type HMBlockNode, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {base58btc} from 'multiformats/bases/base58'

/** One trigger document, read and resolved. */
export type TriggerDocument = {
  /** Versionless hm:// id. */
  documentId: string
  version: string
  /** The account that signed the version read: whose trigger this is. */
  author: string | null
  name: string
  enabled: boolean
  /** The trigger source as published (validated by the service). */
  source: unknown
  /** hm:// URL of the host tool to call, or null to start an agent session. */
  tool: string | null
  /** The tool's input template, if any. */
  input: unknown
  /** For an app's trigger with no tool: hm:// URL of the agent whose session it starts. */
  agent: string | null
  /** The document's body: an agent session trigger's first message. */
  content: HMBlockNode[]
}

/** What a host lists: its readable triggers, and why any listed one could not be read. */
export type HostTriggers = {
  /** False when the host document itself could not be read: keep what is projected. */
  found: boolean
  hostType: 'app' | 'agent' | null
  triggers: TriggerDocument[]
  errors: {documentId: string; error: string}[]
}

type Client = Pick<SeedClient, 'request'>

/** Reads every trigger `hostId` lists. `cache` keeps resolved documents by id and version. */
export async function readHostTriggers(
  client: Client,
  hostId: UnpackedHypermediaId,
  cache?: Map<string, TriggerDocument>,
): Promise<HostTriggers> {
  const host = await client.request('Resource', hostId).catch(() => null)
  if (host?.type !== 'document' || !isToolHostType(host.document.metadata?.type))
    return {found: host?.type === 'not-found', hostType: null, triggers: [], errors: []}
  const hostType = host.document.metadata?.type === 'hm://hyper.media/app' ? 'app' : 'agent'
  const triggers: TriggerDocument[] = []
  const errors: HostTriggers['errors'] = []
  for (const child of appEmbeddedChildren(hostId, host.document.content)) {
    const resource = await client.request('Resource', child.id).catch(() => null)
    if (resource?.type !== 'document') continue
    const document = resource.document
    if (document.metadata?.type !== HM_TRIGGER_TYPE) continue
    const documentId = child.id.id
    const cached = cache?.get(documentId)
    if (cached && cached.version === document.version) {
      triggers.push(cached)
      continue
    }
    try {
      const refs = triggerDocumentRefs(document.metadata as Record<string, unknown>)
      if (!refs.sourceCid) throw new Error('This trigger has no source: set when it fires')
      const [source, input, author] = await Promise.all([
        readBlobValue(client, refs.sourceCid),
        refs.inputCid ? readBlobValue(client, refs.inputCid) : Promise.resolve(undefined),
        signerOfVersion(client, document.version),
      ])
      if (refs.tool) assertHostTool(hostId, refs.tool)
      if (refs.tool && refs.agent) throw new Error('This trigger names both a tool and an agent: keep one')
      if (refs.agent && hostType === 'agent' && unpackHmId(refs.agent)?.id !== hostId.id)
        throw new Error('A trigger under an agent starts a session with that agent: remove its agent field')
      const trigger: TriggerDocument = {
        documentId,
        version: document.version,
        author,
        name:
          (typeof document.metadata?.name === 'string' && document.metadata.name) || child.id.path?.at(-1) || 'Trigger',
        enabled: refs.enabled,
        source,
        tool: refs.tool,
        input,
        agent: hostType === 'app' ? refs.agent : null,
        content: document.content ?? [],
      }
      cache?.set(documentId, trigger)
      triggers.push(trigger)
    } catch (error) {
      errors.push({documentId, error: error instanceof Error ? error.message : String(error)})
    }
  }
  return {found: true, hostType, triggers, errors}
}

/** A trigger may only call a tool of its own host. */
function assertHostTool(hostId: UnpackedHypermediaId, tool: string) {
  const toolId = unpackHmId(tool)
  const parent = toolId ? parentDocumentId(toolId) : null
  if (!toolId || !parent || parent.id !== hostId.id)
    throw new Error(`The trigger calls ${tool}, which is not a tool of ${hostId.id}`)
}

/** The decoded value of a DAG-CBOR blob. */
async function readBlobValue(client: Client, cid: string): Promise<unknown> {
  const result = await client.request('GetCID', {cid})
  if (result.value === undefined) throw new Error(`Blob ${cid} is not available`)
  return result.value
}

/** The account that signed the (first head of the) version, or null when it cannot be read. */
export async function signerOfVersion(client: Client, version: string): Promise<string | null> {
  const head = version.split('.')[0]
  if (!head) return null
  const change = await client.request('GetCID', {cid: head}).catch(() => null)
  return principalToUid((change?.value as {signer?: unknown} | undefined)?.signer)
}

/** A principal (raw multicodec-prefixed key bytes, possibly in dag-json form) as a z6Mk… uid. */
export function principalToUid(value: unknown): string | null {
  if (typeof value === 'string') return value.startsWith('z') ? value : null
  let bytes: Uint8Array | null = null
  if (value instanceof Uint8Array) bytes = value
  else if (value && typeof value === 'object') {
    const inner = (value as {'/'?: {bytes?: unknown}})['/']
    if (inner && typeof inner.bytes === 'string') bytes = new Uint8Array(Buffer.from(inner.bytes, 'base64'))
  }
  return bytes ? base58btc.encode(bytes) : null
}
