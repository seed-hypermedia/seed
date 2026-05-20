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
import {nanoid} from 'nanoid'
import {putWebDocDraft} from './web-draft-db'

/** Route emitted after a local web document draft is created. */
export type WebDocumentDraftRoute = {key: 'document'; id: UnpackedHypermediaId}

/** Create a local web document draft and navigate to its document route. */
export async function createWebDocumentDraft({
  locationId,
  signingAccountId,
  visibility = 'PUBLIC',
  content = [],
  metadata = {},
  navigate,
  generateDraftId = () => nanoid(10),
  generatePath = () => nanoid(21),
}: {
  locationId: UnpackedHypermediaId
  signingAccountId: string
  visibility?: HMResourceVisibility
  content?: HMBlockNode[]
  metadata?: HMMetadata
  navigate: (route: WebDocumentDraftRoute) => void
  generateDraftId?: () => string
  generatePath?: () => string
}): Promise<UnpackedHypermediaId> {
  const draftId = generateDraftId()
  const isPrivate = visibility === 'PRIVATE'
  const locationPath = isPrivate ? [generatePath()] : locationId.path || []
  const editPath = isPrivate ? locationPath : [...locationPath, `-${draftId}`]
  const routeId = hmId(locationId.uid, {path: editPath})

  await putWebDocDraft({
    draftId,
    docId: routeId.id,
    signingAccountId,
    content,
    metadata,
    deps: [],
    navigation: null,
    locationUid: locationId.uid,
    locationPath,
    editUid: locationId.uid,
    editPath,
    cursorPosition: null,
    visibility,
  })

  navigate({key: 'document', id: routeId})
  return routeId
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
}: {
  file: File
  locationId: UnpackedHypermediaId
  signingAccountId: string
  navigate: (route: WebDocumentDraftRoute) => void
}): Promise<UnpackedHypermediaId> {
  const text = await file.text()
  const {metadata, markdown} = parseMarkdownImport(text, file.name)

  return createWebDocumentDraft({
    locationId,
    signingAccountId,
    metadata,
    content: markdownToHMBlockNodes(markdown),
    navigate,
  })
}
