import type {HMBlockNode, HMMetadata, HMResourceVisibility, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

/** Options accepted by inline draft creation across platforms. Structural — keep
 * in sync with editor's `CreateInlineDraftOptions` (which is a superset). */
export type InlineDraftOptions = {
  initialContent?: HMBlockNode[]
  name?: string
}

/**
 * Write payload produced by {@link buildInlineDraftWrite}. Field names match
 * `client.drafts.write.mutate` (desktop trpc) and `putWebDocDraft` (web
 * IndexedDB) so platform providers can pass it through unchanged.
 */
export type InlineDraftWrite = {
  id: string
  locationUid: string
  locationPath: string[]
  editUid: string
  editPath: string[]
  metadata: HMMetadata
  content: HMBlockNode[]
  deps: string[]
  visibility: HMResourceVisibility
}

/**
 * Build the canonical inline-draft write payload. Both desktop and web call
 * this so the on-disk draft shape stays identical regardless of storage
 * backend. The draft lives at `parentPath + '-' + draftId` so it has a
 * stable, unique path before publish; `locationUid/Path` track the parent
 * (so child-draft listings include it) and `editUid/Path` track the new
 * placeholder path (so existing-draft lookup hits when the editor mounts at
 * the new doc's route URL).
 */
export function buildInlineDraftWrite({
  parentId,
  draftId,
  options,
  visibility = 'PUBLIC',
}: {
  parentId: UnpackedHypermediaId
  draftId: string
  options?: InlineDraftOptions
  visibility?: HMResourceVisibility
}): InlineDraftWrite {
  const parentPath = parentId.path ?? []
  const draftPath = [...parentPath, `-${draftId}`]
  const metadata: HMMetadata = {name: options?.name ?? ''}
  return {
    id: draftId,
    locationUid: parentId.uid,
    locationPath: parentPath,
    editUid: parentId.uid,
    editPath: draftPath,
    metadata,
    content: options?.initialContent ?? [],
    deps: [],
    visibility,
  }
}
