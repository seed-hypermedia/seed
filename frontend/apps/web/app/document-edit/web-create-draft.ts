import type {
  HMBlockNode,
  HMMetadata,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  markdownBlockNodesToHMBlockNodes,
  parseFrontmatter,
  parseMarkdown,
} from '@seed-hypermedia/client/markdown-to-blocks'
import {hmId} from '@shm/shared'
import {buildInlineDraftWrite} from '@shm/shared/utils/inline-draft'
import {nanoid} from 'nanoid'
import {putWebDocDraft} from './web-draft-db'

/** Route emitted after a local web document draft is created. */
export type WebDocumentDraftRoute = {key: 'document'; id: UnpackedHypermediaId}

/** Result returned by {@link createWebDocumentDraft}. */
export type CreateWebDocumentDraftResult = {
  /** Route id (uid + edit path) of the new draft. */
  routeId: UnpackedHypermediaId
  /** Persistent draft id (used as `embed.draftId` on inline embed inserts). */
  draftId: string
  /** Edit path of the new draft under its parent. */
  draftPath: string[]
}

/**
 * Create a local web document draft and optionally navigate to its document
 * route. When `navigate` is omitted (slash menu / query block "+"), the draft
 * is persisted but the route does not change — callers receive the new draft
 * id so they can insert an inline embed without leaving the current document.
 */
export async function createWebDocumentDraft({
  locationId,
  signingAccountId,
  visibility = 'PUBLIC',
  content,
  metadata,
  navigate,
  generateDraftId = () => nanoid(10),
  generatePath = () => nanoid(21),
  capabilityCid,
}: {
  locationId: UnpackedHypermediaId
  signingAccountId: string
  visibility?: HMResourceVisibility
  content?: HMBlockNode[]
  metadata?: HMMetadata
  capabilityCid?: string
  navigate?: (route: WebDocumentDraftRoute) => void
  generateDraftId?: () => string
  generatePath?: () => string
}): Promise<CreateWebDocumentDraftResult> {
  const draftId = generateDraftId()
  const isPrivate = visibility === 'PRIVATE'

  let locationPath: string[]
  let editPath: string[]
  let writeMetadata: HMMetadata
  let writeContent: HMBlockNode[]

  if (isPrivate) {
    locationPath = [generatePath()]
    editPath = locationPath
    writeMetadata = metadata ?? {}
    writeContent = content ?? []
  } else {
    const writeParams = buildInlineDraftWrite({parentId: locationId, draftId, visibility})
    locationPath = writeParams.locationPath
    editPath = writeParams.editPath
    // Don't seed an empty `name`: persisting `{name: ''}` makes the publish flow
    // emit a setAttribute(name, '') change. Keep metadata empty unless provided,
    // matching the original web behavior.
    writeMetadata = metadata ?? {}
    writeContent = content ?? writeParams.content
  }

  const routeId = hmId(locationId.uid, {path: editPath})

  await putWebDocDraft({
    draftId,
    docId: routeId.id,
    signingAccountId,
    ...(capabilityCid ? {capabilityCid} : {}),
    content: writeContent,
    metadata: writeMetadata,
    deps: [],
    navigation: null,
    locationUid: locationId.uid,
    locationPath,
    editUid: locationId.uid,
    editPath,
    cursorPosition: null,
    visibility,
  })

  console.log('[web-create-doc] createWebDocumentDraft', {
    locationId: locationId.id,
    draftId,
    draftPath: editPath,
    visibility,
    willNavigate: !!navigate,
  })

  if (navigate) navigate({key: 'document', id: routeId})
  return {routeId, draftId, draftPath: editPath}
}

function parseMarkdownImport(markdown: string, fileName: string): {metadata: HMMetadata; markdown: string} {
  let {content, metadata} = parseFrontmatter(markdown)
  let title = metadata.name?.trim()

  if (!title) {
    const lines = content.split('\n')
    const headingIndex = lines.findIndex((line) => line.trim().startsWith('# '))
    if (headingIndex !== -1) {
      title = lines[headingIndex]?.replace(/^#\s+/, '').trim()
      lines.splice(headingIndex, 1)
      content = lines.join('\n')
    }
  }

  const fallbackTitle = fileName.replace(/\.[^/.]+$/, '').trim() || 'Imported Document'
  return {metadata: {...metadata, name: title || fallbackTitle}, markdown: content}
}

function markdownToHMBlockNodes(markdown: string): HMBlockNode[] {
  const {tree} = parseMarkdown(markdown)
  return markdownBlockNodesToHMBlockNodes(tree)
}

/** Import a Markdown file into a local web document draft and navigate to it. */
export async function createWebDocumentDraftFromMarkdownFile({
  file,
  locationId,
  signingAccountId,
  navigate,
  capabilityCid,
}: {
  file: File
  locationId: UnpackedHypermediaId
  signingAccountId: string
  capabilityCid?: string
  navigate: (route: WebDocumentDraftRoute) => void
}): Promise<CreateWebDocumentDraftResult> {
  const text = await file.text()
  const {metadata, markdown} = parseMarkdownImport(text, file.name)

  return createWebDocumentDraft({
    locationId,
    signingAccountId,
    capabilityCid,
    metadata,
    content: markdownToHMBlockNodes(markdown),
    navigate,
  })
}
