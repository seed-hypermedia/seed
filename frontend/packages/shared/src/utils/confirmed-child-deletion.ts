import {unpackHmId, type HMBlockNode, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {UniversalClient} from '../universal-client'
import {
  getDirectChildrenLosingReferences,
  getDocumentReferenceLinks,
  hmLinkTargetsDocument,
  hasSelfQueryBlock,
} from './document-card-cleanup'
import {hmId} from './entity-id-url'
import {hmIdPathToEntityQueryPath} from './path-api'

/** The exact document versions the user approved deleting from one direct child's subtree. */
export type ConfirmedChildDeletion = {
  childId: UnpackedHypermediaId
  documents: Array<{id: string; version: string; title?: string}>
}

/** Published direct children whose last authored reference is being removed. */
export type ConfirmChildDeletionInput = {
  parentId: UnpackedHypermediaId
  childIds: UnpackedHypermediaId[]
  /** The draft removed the published self-query; inspect its full direct-child scope. */
  removedSelfQuery?: boolean
  /** Authored removed destinations, including raw custom-domain URLs awaiting resolution. */
  removedReferenceTargets?: string[]
  /** Current parent content; surviving resolved aliases suppress a deletion proposal. */
  content?: HMBlockNode[]
}

/** Reads a fresh deletion scope without following redirects or using cached directory data. */
export async function inspectChildDeletions(
  client: Pick<UniversalClient, 'request'>,
  {parentId, childIds, removedReferenceTargets, content, removedSelfQuery}: ConfirmChildDeletionInput,
): Promise<ConfirmedChildDeletion[]> {
  if (content && hasSelfQueryBlock(content, parentId.id)) return []
  const result: ConfirmedChildDeletion[] = []
  const parentPath = parentId.path || []
  const candidates = new Map(childIds.map((id) => [id.id, id]))
  if (removedSelfQuery) {
    const directory = await client.request('Query', {
      includes: [{space: parentId.uid, path: hmIdPathToEntityQueryPath(parentId.path), mode: 'Children'}],
    })
    if (!directory) throw new Error('Could not load the children referenced by the removed query')
    for (const {id} of directory.results) {
      const path = id.path || []
      if (
        id.uid === parentId.uid &&
        path.length === parentPath.length + 1 &&
        parentPath.every((part, i) => path[i] === part)
      ) {
        const canonical = hmId(id.uid, {path})
        candidates.set(canonical.id, canonical)
      }
    }
  }
  if (removedReferenceTargets?.length) {
    const former = removedReferenceTargets.map(
      (link) => ({block: {id: link, type: 'Embed', link, attributes: {view: 'Card'}}, children: []}) as HMBlockNode,
    )
    const removed = await resolveDirectDocumentReferences(former)
    for (const id of removed.ids) {
      const path = id.path || []
      if (
        id.uid === parentId.uid &&
        path.length === parentPath.length + 1 &&
        parentPath.every((part, i) => path[i] === part)
      )
        candidates.set(id.id, id)
    }
  }
  if (content) {
    const remaining = await resolveDirectDocumentReferences(content)
    for (const id of remaining.ids) candidates.delete(id.id)
  }
  for (const childId of Array.from(candidates.values())) {
    const childPath = childId.path || []
    if (
      childId.uid !== parentId.uid ||
      childPath.length !== parentPath.length + 1 ||
      !parentPath.every((part, i) => childPath[i] === part)
    ) {
      throw new Error('Deletion target must be a direct child of its parent')
    }
    const directory = await client.request('Query', {
      includes: [{space: childId.uid, path: hmIdPathToEntityQueryPath(childId.path), mode: 'AllDescendants'}],
    })
    if (!directory) throw new Error('Could not load the complete child deletion scope')
    const ids = [
      childId,
      ...directory.results
        .map((item) => item.id)
        .filter(
          (id) =>
            id.uid === childId.uid &&
            (id.path || []).length > childPath.length &&
            childPath.every((part, i) => id.path?.[i] === part),
        ),
    ]
    const documents: ConfirmedChildDeletion['documents'] = []
    for (const id of ids) {
      const canonical = hmId(id.uid, {path: id.path})
      const resource = await client.request('Resource', canonical)
      if (resource.type === 'tombstone') continue
      if (resource.type !== 'document')
        throw new Error(`Confirmation required: ${canonical.id} is no longer the same document (${resource.type})`)
      if (!resource.document.version) throw new Error('Could not determine child document version')
      documents.push({
        id: canonical.id,
        version: resource.document.version,
        ...(resource.document.metadata?.name ? {title: resource.document.metadata.name} : {}),
      })
    }
    if (documents.length) result.push({childId: hmId(childId.uid, {path: childId.path}), documents})
  }
  return result
}

/** Revalidates consent before publication or destructive retry; removed approved documents are idempotent. */
export async function validateConfirmedChildDeletions(
  client: Pick<UniversalClient, 'request'>,
  input: {parentId: UnpackedHypermediaId; content: HMBlockNode[]; confirmations: ConfirmedChildDeletion[]},
): Promise<void> {
  const references = await resolveDirectDocumentReferences(input.content)
  if (references.unresolved.length)
    throw new Error('Confirmation required: unresolved external reference must be reviewed manually')
  for (const confirmation of input.confirmations) {
    if (references.ids.some((id) => hmLinkTargetsDocument(id.id, confirmation.childId.id)))
      throw new Error('Confirmation required: the parent still contains a reference to this child')
    // A synthetic former reference lets the shared exhaustive reference scanner check
    // cards, block links, inline links, and surviving self-queries.
    const formerReference = [
      {
        block: {id: 'reference', type: 'Embed', link: confirmation.childId.id, attributes: {view: 'Card'}},
        children: [],
      },
    ] as HMBlockNode[]
    if (!getDirectChildrenLosingReferences(input.parentId, formerReference, input.content).length) {
      throw new Error('Confirmation required: the parent contains a reference to this child again')
    }
    const approved = new Map(confirmation.documents.map((document) => [document.id, document.version]))
    const current = await inspectChildDeletions(client, {parentId: input.parentId, childIds: [confirmation.childId]})
    for (const document of current.flatMap((scope) => scope.documents)) {
      if (approved.get(document.id) !== document.version)
        throw new Error('Confirmation required: the child deletion scope has changed')
    }
    // Check disappeared approved paths too: a redirect must never be treated as a
    // completed deletion or followed to its destination.
    const currentIds = new Set(current.flatMap((scope) => scope.documents.map((document) => document.id)))
    for (const document of confirmation.documents) {
      if (currentIds.has(document.id)) continue
      const id = unpackHmId(document.id)
      if (!id) throw new Error('Confirmation required: an approved document ID is invalid')
      const resource = await client.request('Resource', id)
      if (resource.type !== 'tombstone')
        throw new Error('Confirmation required: an approved document moved or is unavailable')
    }
  }
}

/** Executes only the currently valid, explicitly approved subtree; tombstones make interrupted retries idempotent. */
export async function executeConfirmedChildDeletion(
  client: Pick<UniversalClient, 'request' | 'getSigner' | 'publish'>,
  input: {
    parentDocumentId: string
    sourceDocumentId?: string
    approvedSubtree?: Array<{id: string; version: string}>
    authorizingParentVersion?: string
    signingAccountUid: string
    capabilityId?: string
  },
): Promise<void> {
  const parentId = unpackHmId(input.parentDocumentId)
  const childId = input.sourceDocumentId ? unpackHmId(input.sourceDocumentId) : null
  if (!parentId || !childId || !input.approvedSubtree?.length || !input.authorizingParentVersion) {
    throw new Error('Confirmation required: deletion approval is incomplete')
  }
  if (!client.getSigner) throw new Error('Signing is not available')
  const parent = await client.request('Resource', hmId(parentId.uid, {path: parentId.path}))
  if (parent.type !== 'document') throw new Error('Confirmation required: authorizing parent is unavailable')
  const authorizing = await client.request(
    'Resource',
    hmId(parentId.uid, {path: parentId.path, version: input.authorizingParentVersion}),
  )
  if (
    authorizing.type !== 'document' ||
    authorizing.document.version.split('.').sort().join('.') !==
      input.authorizingParentVersion.split('.').sort().join('.') ||
    !authorizing.document.genesis ||
    authorizing.document.genesis !== parent.document.genesis
  ) {
    throw new Error('Confirmation required: authorizing parent publication cannot be verified')
  }
  await validateConfirmedChildDeletions(client, {
    parentId,
    content: authorizing.document.content,
    confirmations: [{childId, documents: input.approvedSubtree}],
  })
  // Do not follow redirects, and recheck every remaining reference and approved version.
  await validateConfirmedChildDeletions(client, {
    parentId,
    content: parent.document.content,
    confirmations: [{childId, documents: input.approvedSubtree}],
  })
  const signer = client.getSigner(input.signingAccountUid)
  const {createTombstoneRef} = await import('@seed-hypermedia/client')
  const deepestFirst = [...input.approvedSubtree].sort(
    (a, b) => (unpackHmId(b.id)?.path?.length || 0) - (unpackHmId(a.id)?.path?.length || 0),
  )
  for (const approved of deepestFirst) {
    const id = unpackHmId(approved.id)!
    const resource = await client.request('Resource', id)
    if (resource.type === 'tombstone') continue
    if (resource.type !== 'document' || resource.document.version !== approved.version) {
      throw new Error('Confirmation required: child changed before deletion')
    }
    const latestParent = await client.request('Resource', hmId(parentId.uid, {path: parentId.path}))
    if (latestParent.type !== 'document' || latestParent.document.genesis !== authorizing.document.genesis)
      throw new Error('Confirmation required: authorizing parent is unavailable or was replaced')
    await validateConfirmedChildDeletions(client, {
      parentId,
      content: latestParent.document.content,
      confirmations: [{childId, documents: input.approvedSubtree}],
    })
    // The backend has no conditional tombstone primitive. These fresh checks narrow,
    // but cannot eliminate, a remote edit between validation and publication.
    await client.publish(
      await createTombstoneRef(
        {
          space: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          genesis: resource.document.genesis,
          generation: Number(resource.document.generationInfo?.generation || 0),
          capability: input.capabilityId,
        },
        signer,
      ),
    )
  }
}

/** Keeps authored removal intent aligned with system moves/renames without creating new deletion intent. */
export function reconcileChildRemovalIntent(
  operation: {operation?: string; sourceDocumentId?: string; deletedDocumentId?: string; targetDocumentId?: string},
  removedDocumentIds: string[],
): string[] {
  const source = operation.sourceDocumentId || operation.deletedDocumentId
  if (!source) return removedDocumentIds
  return Array.from(
    new Set(
      removedDocumentIds.flatMap((id) => {
        if (!hmLinkTargetsDocument(id, source)) return [id]
        if (operation.operation === 'rewrite' && operation.targetDocumentId) return [operation.targetDocumentId]
        if (!operation.operation || operation.operation === 'remove') return []
        return [id]
      }),
    ),
  )
}

/** Reviews a changed deletion scope without granting consent; callers must display and confirm the returned versions. */
export async function reviewConfirmedChildDeletion(
  client: Pick<UniversalClient, 'request'>,
  input: {
    parentDocumentId: string
    sourceDocumentId?: string
    approvedSubtree?: Array<{id: string; version: string}>
    authorizingParentVersion?: string
  },
): Promise<Array<{id: string; version: string}>> {
  const parentId = unpackHmId(input.parentDocumentId)
  const childId = input.sourceDocumentId ? unpackHmId(input.sourceDocumentId) : null
  const originalChild = input.approvedSubtree?.find((document) => document.id === childId?.id)
  if (!parentId || !childId || !originalChild || !input.authorizingParentVersion)
    throw new Error('Confirmation required: original deletion approval is incomplete')
  const parent = await client.request('Resource', hmId(parentId.uid, {path: parentId.path}))
  const authorizing = await client.request(
    'Resource',
    hmId(parentId.uid, {path: parentId.path, version: input.authorizingParentVersion}),
  )
  if (
    parent.type !== 'document' ||
    authorizing.type !== 'document' ||
    authorizing.document.version.split('.').sort().join('.') !==
      input.authorizingParentVersion.split('.').sort().join('.') ||
    !parent.document.genesis ||
    parent.document.genesis !== authorizing.document.genesis
  )
    throw new Error('Confirmation required: authorizing parent publication cannot be verified')
  const original = await client.request(
    'Resource',
    hmId(childId.uid, {path: childId.path, version: originalChild.version}),
  )
  const child = await client.request('Resource', hmId(childId.uid, {path: childId.path}))
  if (
    original.type !== 'document' ||
    child.type !== 'document' ||
    original.document.version.split('.').sort().join('.') !== originalChild.version.split('.').sort().join('.') ||
    !original.document.genesis ||
    child.document.genesis !== original.document.genesis
  )
    throw new Error('Confirmation required: the original child moved, was deleted, or was replaced')
  const confirmations = await inspectChildDeletions(client, {parentId, childIds: [childId]})
  await validateConfirmedChildDeletions(client, {parentId, content: authorizing.document.content, confirmations})
  await validateConfirmedChildDeletions(client, {parentId, content: parent.document.content, confirmations})
  return confirmations.flatMap((confirmation) => confirmation.documents)
}

/** Resolves authored references at the I/O boundary; unknown web links remain explicit instead of implying absence. */
export async function resolveDirectDocumentReferences(
  content: HMBlockNode[],
): Promise<{ids: UnpackedHypermediaId[]; unresolved: string[]}> {
  const ids = new Map<string, UnpackedHypermediaId>()
  const unresolved: string[] = []
  for (const link of Array.from(new Set(getDocumentReferenceLinks(content)))) {
    let id = unpackHmId(link)
    if (!id && /^https?:\/\//.test(link)) {
      try {
        const {resolveHypermediaUrl} = await import('@seed-hypermedia/client')
        id = (await resolveHypermediaUrl(link, {requireSuccessfulResponse: true}))?.hmId ?? null
      } catch {
        id = null
        unresolved.push(link)
      }
    }
    if (id) {
      const canonical = hmId(id.uid, {path: id.path})
      ids.set(canonical.id, canonical)
    }
  }
  return {ids: Array.from(ids.values()), unresolved}
}
