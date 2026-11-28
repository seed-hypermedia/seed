import type {
  HMDocument,
  HMDocumentInfo,
  HMRawDocumentChange,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '../content'
import {queryDirectory} from '../models/queries'
import type {UniversalClient} from '../universal-client'
import {hmId} from './entity-id-url'
import {documentHasNavigationCard} from './document-card-cleanup'

/** Sites whose Home was first published before this UTC instant are eligible for the migration offer. */
export const SHAPE_HOME_CUTOFF_MS = Date.UTC(2026, 11, 1)

/** A first-level published page that is not yet linked as a Card on Home. */
export type ShapeHomeCandidate = {
  id: UnpackedHypermediaId
  title: string
}

/** Result of loading the migration status for a single Home. */
export type ShapeHomeStatus = {
  firstPublishedAt: number | null
  candidates: ShapeHomeCandidate[]
  eligible: boolean
}

/** Returns the earliest non-genesis change createTime (ms) from a `ListChanges` response. */
export function homeFirstPublishedAt(changes: HMRawDocumentChange[]): number | null {
  let earliest: number | null = null
  for (const change of changes) {
    const raw = change.createTime
    if (!raw || raw === '0') continue
    const ms = typeof raw === 'string' ? Date.parse(raw) : Number(raw)
    if (!Number.isFinite(ms) || ms <= 0) continue
    if (earliest === null || ms < earliest) earliest = ms
  }
  return earliest
}

function candidateTitle(child: HMDocumentInfo): string {
  const name = getMetadataName(child.metadata)
  if (name && name !== 'Untitled Document') return name
  const path = child.id.path || []
  return path[path.length - 1] || child.id.id
}

function sortKey(title: string): string {
  let i = 0
  while (i < title.length) {
    const code = title.charCodeAt(i)
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code >= 192) {
      break
    }
    i++
  }
  return title.slice(i)
}

/** Returns the public root-level children of Home that are not yet Cards, sorted for display. */
export function getShapeHomeCandidates(input: {
  homeId: UnpackedHypermediaId
  home: Pick<HMDocument, 'content' | 'navigationCards'>
  children: HMDocumentInfo[]
}): ShapeHomeCandidate[] {
  const parentPath = input.homeId.path || []
  const candidates = input.children.filter((child) => {
    const childPath = child.id.path || []
    if (childPath.length !== parentPath.length + 1) return false
    if (!parentPath.every((segment, index) => childPath[index] === segment)) return false
    if (child.visibility === 'PRIVATE') return false
    if (documentHasNavigationCard(input.home, child.id.id)) return false
    return true
  })
  return candidates
    .map((child) => ({id: child.id, title: candidateTitle(child)}))
    .sort((a, b) => {
      const ak = sortKey(a.title)
      const bk = sortKey(b.title)
      const cmp = ak.localeCompare(bk, undefined, {sensitivity: 'base'})
      if (cmp !== 0) return cmp
      return a.id.id.localeCompare(b.id.id)
    })
}

/** A site is eligible when Home was first published before the cutoff and at least one Card is missing. */
export function isShapeHomeEligible(input: {
  firstPublishedAt: number | null
  candidates: ShapeHomeCandidate[]
}): boolean {
  return input.firstPublishedAt !== null && input.firstPublishedAt < SHAPE_HOME_CUTOFF_MS && input.candidates.length > 0
}

/** Loads the migration status for a Home by fetching the latest Home, its history, and its children. */
export async function loadShapeHomeStatus(client: UniversalClient, uid: string): Promise<ShapeHomeStatus> {
  const homeId = hmId(uid)
  const resource = await client.request('Resource', {...homeId, version: null, latest: true})
  if (resource.type !== 'document') {
    return {firstPublishedAt: null, candidates: [], eligible: false}
  }
  const home = resource.document
  const changesResponse = await client.request('ListChanges', {targetId: homeId})
  const firstPublishedAt = homeFirstPublishedAt(changesResponse.changes)
  const children = await queryDirectory(client, homeId, 'Children').queryFn()
  const candidates = getShapeHomeCandidates({homeId, home, children})
  return {
    firstPublishedAt,
    candidates,
    eligible: isShapeHomeEligible({firstPublishedAt, candidates}),
  }
}
