/**
 * Keeps an app's card embeds in step with the tools and pages written under it (see
 * hypermedia/apps/apps-and-tools.md). Creating a child of an app adds its embed in the same
 * publish; deleting one removes it. A tool or a trigger must be a child of an app or an agent.
 */

import {
  addAppChildOps,
  appChildKind,
  createDocumentUpdateBlobs,
  HM_AGENT_TYPE,
  HM_APP_TYPE,
  isToolHostType,
  HM_TOOL_TYPE,
  HM_TRIGGER_TYPE,
  parentDocumentId,
  removeAppChildOps,
} from '@seed-hypermedia/client/apps'
import type {CollectedBlob, SeedClient, UnpackedHypermediaId} from '@seed-hypermedia/client'
import type {AnySigner} from '@seed-hypermedia/client/signer'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'

/** The app a child document is written under, with its current content. */
export type AppParent = {id: UnpackedHypermediaId; document: HMDocument}

/** Why a tool was refused: it was not written directly under an app or an agent. */
export const TOOL_OUTSIDE_APP_ERROR = `A tool lives directly under an app or an agent. Write the app first (a document with metadata.type "${HM_APP_TYPE}"), or use an agent's document, then write the tool at hm://<account>/<app or agent path>/<tool name>. Read ~/tools/write/apps.`

/** Why a trigger was refused: it was not written directly under an app or an agent. */
export const TRIGGER_OUTSIDE_APP_ERROR = `A trigger lives directly under an app or an agent, like a tool: write it at hm://<account>/<app or agent path>/<trigger name>. Read ~/tools/write/triggers.`

/**
 * The app that a new document of `type` at `childId` belongs to (`app` is null when it is not an
 * app child), or a refusal when a tool is written anywhere but directly under an app.
 */
export async function resolveAppParent(
  client: Pick<SeedClient, 'request'>,
  childId: UnpackedHypermediaId,
  type: unknown,
): Promise<{app: AppParent | null; refusal?: string}> {
  // An app made under an agent is listed by the agent, like its tools: agents and apps converge,
  // and an agent should never have to rewrite its own document to show what it made.
  if (type === HM_APP_TYPE) {
    const host = await findListingApp(client, childId)
    return {app: host && host.document.metadata?.type === HM_AGENT_TYPE ? host : null}
  }
  if (!appChildKind(type)) return {app: null}
  const app = await findListingApp(client, childId)
  if (!app && type === HM_TOOL_TYPE) return {app: null, refusal: TOOL_OUTSIDE_APP_ERROR}
  if (!app && type === HM_TRIGGER_TYPE) return {app: null, refusal: TRIGGER_OUTSIDE_APP_ERROR}
  return {app}
}

/** Signed blobs that add (or remove) `childId`'s card embed on its app, or null when nothing changes. */
export async function appEmbedBlobs({
  client,
  signer,
  app,
  childId,
  change,
  capability,
}: {
  client: Pick<SeedClient, 'request'>
  signer: AnySigner
  app: AppParent
  childId: UnpackedHypermediaId
  change: 'add' | 'remove'
  capability?: string
}): Promise<CollectedBlob[] | null> {
  const ops =
    change === 'add'
      ? addAppChildOps(app.id, app.document.content, childId)
      : removeAppChildOps(app.id, app.document.content, childId)
  if (!ops.length) return null
  const update = await createDocumentUpdateBlobs({client, signer, id: app.id, ops, capability})
  return update.blobs
}

/** The app that lists `childId`, if its parent is one; used when a child is deleted. */
export async function findListingApp(
  client: Pick<SeedClient, 'request'>,
  childId: UnpackedHypermediaId,
): Promise<AppParent | null> {
  const parentId = parentDocumentId(childId)
  if (!parentId) return null
  const parent = await client.request('Resource', parentId).catch(() => null)
  if (parent?.type !== 'document' || !isToolHostType(parent.document.metadata?.type)) return null
  return {id: parentId, document: parent.document}
}

const hostLocks = new Map<string, Promise<void>>()

/**
 * Runs `fn` with this server's exclusive use of one host's card list. Two children written under
 * the same app (or agent) at once would each list themselves on the same old content, and one card
 * would overwrite the other; inside the lock each write reads the host fresh.
 */
export async function withHostLock<T>(hostId: string, fn: () => Promise<T>): Promise<T> {
  const previous = hostLocks.get(hostId) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((resolve) => (release = resolve))
  const tail = previous.then(() => mine)
  hostLocks.set(hostId, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (hostLocks.get(hostId) === tail) hostLocks.delete(hostId)
  }
}

/**
 * The card a child needs on its host, from the host as it is now: null when the child has no host
 * that lists children of its type, or the host already lists it. Use inside {@link withHostLock}.
 */
export async function missingCardBlobs({
  client,
  signer,
  childId,
  type,
  capability,
}: {
  client: Pick<SeedClient, 'request'>
  signer: AnySigner
  childId: UnpackedHypermediaId
  type: unknown
  capability?: string
}): Promise<CollectedBlob[] | null> {
  const {app} = await resolveAppParent(client, childId, type)
  if (!app) return null
  return appEmbedBlobs({client, signer, app, childId, change: 'add', capability})
}
