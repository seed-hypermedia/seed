import type {IpfsDirectoryFile} from '@seed-hypermedia/client'
import * as memory from '@/agent-memory'

/** Most files a document app folder may hold. */
export const MAX_DOCUMENT_APP_FILES = 256
/** Most bytes a document app folder may hold in total. */
export const MAX_DOCUMENT_APP_BYTES = 16 * 1024 * 1024

/**
 * Collects the files of a document app from agent memory. The path names either a folder, taken
 * whole (nested folders included, dotfiles skipped) and required to hold an `index.html` at its
 * root, or a single HTML file, which becomes the folder's `index.html`.
 */
export function collectDocumentAppFiles(
  stateDir: string,
  rawPath: string,
): {files: IpfsDirectoryFile[]; bytes: number} {
  const root = rawPath.replace(/^(~\/memory\/|\/workspace\/)/, '').replace(/\/+$/, '')
  let listing: ReturnType<typeof memory.listMemoryDir> | null = null
  try {
    listing = memory.listMemoryDir(stateDir, root)
  } catch (error) {
    if (!(error instanceof memory.AgentMemoryError)) throw error
  }
  if (!listing) {
    const file = memory.readMemoryFile(stateDir, root)
    if (file.encoding !== 'utf8' || !/\.html?$/i.test(root)) throw new Error('A single-file app must be an HTML file')
    const content = new TextEncoder().encode(file.content ?? '')
    if (content.byteLength > MAX_DOCUMENT_APP_BYTES)
      throw new Error(`An app may hold at most ${MAX_DOCUMENT_APP_BYTES} bytes`)
    return {files: [{path: 'index.html', content}], bytes: content.byteLength}
  }
  const files: IpfsDirectoryFile[] = []
  let bytes = 0
  const prefix = listing.path ? `${listing.path}/` : ''
  const walk = (entries: typeof listing.entries) => {
    for (const entry of entries) {
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1)
      if (name.startsWith('.')) continue
      if (entry.type === 'dir') {
        walk(memory.listMemoryDir(stateDir, entry.path).entries)
        continue
      }
      if (files.length >= MAX_DOCUMENT_APP_FILES)
        throw new Error(`An app folder may hold at most ${MAX_DOCUMENT_APP_FILES} files`)
      const file = memory.readMemoryFile(stateDir, entry.path)
      const content =
        file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
      bytes += content.byteLength
      if (bytes > MAX_DOCUMENT_APP_BYTES)
        throw new Error(`An app folder may hold at most ${MAX_DOCUMENT_APP_BYTES} bytes`)
      files.push({path: entry.path.slice(prefix.length), content})
    }
  }
  walk(listing.entries)
  if (!files.some((file) => file.path === 'index.html'))
    throw new Error('An app folder needs an index.html at its root')
  return {files, bytes}
}
