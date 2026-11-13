/**
 * Keeps an app's card embeds in step with the tools and pages written under it (see
 * hypermedia/apps/apps-and-tools.md). Creating a child of an app adds its embed in the same
 * publish; deleting one removes it. A tool must be a child of an app.
 */

import {
  addAppChildOps,
  appChildKind,
  createDocumentUpdateBlobs,
  HM_APP_TYPE,
  isToolHostType,
  HM_TOOL_TYPE,
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

/**
 * The app that a new document of `type` at `childId` belongs to (`app` is null when it is not an
 * app child), or a refusal when a tool is written anywhere but directly under an app.
 */
export async function resolveAppParent(
  client: Pick<SeedClient, 'request'>,
  childId: UnpackedHypermediaId,
  type: unknown,
): Promise<{app: AppParent | null; refusal?: string}> {
  if (!appChildKind(type)) return {app: null}
  const app = await findListingApp(client, childId)
  if (!app && type === HM_TOOL_TYPE) return {app: null, refusal: TOOL_OUTSIDE_APP_ERROR}
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
