/**
 * Per-agent persistent memory filesystem.
 *
 * Every agent owns a private directory at `<stateDir>/memory`. Agent sessions read and write it
 * through the `memory_*` tools, and users get full read/write access through the signed
 * `*AgentMemory*` actions rendered in the desktop Memory tab. All paths are relative to the memory
 * root and are strictly sandboxed: no absolute paths, no `..` traversal, no symlink targets.
 *
 * Files can be UTF-8 text (editable in the Memory tab, readable by the model) or binary (media and
 * other downloads, previewable/downloadable in the Memory tab and publishable to IPFS for use in
 * Hypermedia content).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** Name of the memory directory inside an agent's state directory. */
export const MEMORY_DIR_NAME = 'memory'

/** Maximum length of a normalized relative memory path in bytes. */
export const MAX_MEMORY_PATH_BYTES = 512
/** Maximum directory nesting depth of a memory path. */
export const MAX_MEMORY_PATH_DEPTH = 16
/** Abort a web download when no bytes arrive for this long (idle timeout, not a total cap). */
export const MEMORY_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000

/** One file or directory inside an agent's memory. */
export type AgentMemoryEntry = {
  /** Relative path from the memory root, always `/`-separated. */
  path: string
  type: 'file' | 'dir'
  /** File size in bytes; 0 for directories. */
  size: number
  /** Last modification time in Unix epoch milliseconds. */
  updatedAt: number
  /** MIME type inferred from the file extension, when recognized. */
  mimeType?: string
  /** For directories in single-level listings: how many entries the directory holds. */
  entryCount?: number
}

/** Contents of one memory file: UTF-8 text or raw binary bytes. */
export type AgentMemoryFileData = {
  path: string
  size: number
  updatedAt: number
  mimeType?: string
  /** How the file content is delivered: `utf8` uses `content`, `binary` uses `data`. */
  encoding: 'utf8' | 'binary'
  content?: string
  data?: Uint8Array
}

/** Result of downloading a web URL into memory. */
export type AgentMemoryDownloadResult = {
  entry: AgentMemoryEntry
  /** URL actually fetched, after redirects. */
  finalUrl: string
  /** Content type reported by the server, when present. */
  contentType?: string
}

/** Error raised for invalid memory paths or unusable memory content. */
export class AgentMemoryError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** MIME types inferred from file extensions, for previews and IPFS uploads. */
const MIME_TYPES: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  ts: 'text/plain',
  xml: 'application/xml',
  yaml: 'text/plain',
  yml: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  wasm: 'application/wasm',
}

/** Returns the MIME type inferred from a path's file extension, when recognized. */
export function inferMimeType(filePath: string): string | undefined {
  const ext = filePath.split('.').at(-1)?.toLowerCase()
  return ext ? MIME_TYPES[ext] : undefined
}

/** Returns a known file extension for a MIME type, used to name extension-less downloads. */
function extensionForMimeType(mimeType: string): string | undefined {
  const bare = mimeType.split(';')[0]?.trim().toLowerCase()
  for (const [ext, mime] of Object.entries(MIME_TYPES)) {
    if (mime === bare) return ext
  }
  return undefined
}

/** Returns the memory root directory for an agent state directory. */
export function memoryRootPath(stateDir: string): string {
  return path.join(stateDir, MEMORY_DIR_NAME)
}

/**
 * Validates a user- or model-supplied relative path and resolves it inside the memory root.
 * Returns the normalized relative path (always `/`-separated) and the absolute filesystem path.
 */
export function resolveMemoryPath(stateDir: string, rawPath: unknown): {relPath: string; absPath: string} {
  if (typeof rawPath !== 'string') throw new AgentMemoryError(400, 'Memory path must be a string')
  if (rawPath.includes('\0')) throw new AgentMemoryError(400, 'Memory path contains an invalid character')
  const segments = rawPath
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
  if (!segments.length) throw new AgentMemoryError(400, 'Memory path is required')
  if (segments.length > MAX_MEMORY_PATH_DEPTH) throw new AgentMemoryError(400, 'Memory path is nested too deeply')
  for (const segment of segments) {
    if (segment === '..') throw new AgentMemoryError(400, 'Memory path cannot contain ".."')
  }
  const relPath = segments.join('/')
  if (new TextEncoder().encode(relPath).byteLength > MAX_MEMORY_PATH_BYTES) {
    throw new AgentMemoryError(400, 'Memory path is too long')
  }
  const root = memoryRootPath(stateDir)
  const absPath = path.join(root, ...segments)
  const relative = path.relative(root, absPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AgentMemoryError(400, 'Memory path escapes the memory directory')
  }
  return {relPath, absPath}
}

/** Lists every file and directory in the agent's memory, sorted by path. */
export function listMemory(stateDir: string): {entries: AgentMemoryEntry[]; totalBytes: number} {
  const root = memoryRootPath(stateDir)
  const entries: AgentMemoryEntry[] = []
  let totalBytes = 0
  const walk = (dirAbs: string, dirRel: string): void => {
    let names: fs.Dirent[]
    try {
      names = fs.readdirSync(dirAbs, {withFileTypes: true})
    } catch {
      return
    }
    for (const dirent of names) {
      const rel = dirRel ? `${dirRel}/${dirent.name}` : dirent.name
      const abs = path.join(dirAbs, dirent.name)
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        const stat = statOrNull(abs)
        entries.push({path: rel, type: 'dir', size: 0, updatedAt: stat?.mtimeMs ? Math.round(stat.mtimeMs) : 0})
        walk(abs, rel)
      } else if (dirent.isFile()) {
        const stat = statOrNull(abs)
        if (!stat) continue
        totalBytes += stat.size
        entries.push(fileEntry(rel, stat))
      }
    }
  }
  walk(root, '')
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {entries, totalBytes}
}

/**
 * Lists one directory level of the agent's memory: the entries directly inside `rawPath`
 * (or the memory root when omitted), without descending. Directory entries carry
 * `entryCount` so callers know whether descending is worthwhile. `totalBytes` sums only
 * the files at this level.
 */
export function listMemoryDir(
  stateDir: string,
  rawPath?: unknown,
): {path: string; entries: AgentMemoryEntry[]; totalBytes: number} {
  const atRoot = rawPath === undefined || rawPath === null || rawPath === '' || rawPath === '/'
  const {relPath, absPath} = atRoot
    ? {relPath: '', absPath: memoryRootPath(stateDir)}
    : resolveMemoryPath(stateDir, rawPath)
  if (!atRoot) {
    const stat = lstatOrNull(absPath)
    if (!stat || stat.isSymbolicLink()) throw new AgentMemoryError(404, `Memory directory not found: ${relPath}`)
    if (!stat.isDirectory())
      throw new AgentMemoryError(400, `Memory path is a file, not a directory: ${relPath}. Use memory_read for files.`)
  }
  let names: fs.Dirent[] = []
  try {
    names = fs.readdirSync(absPath, {withFileTypes: true})
  } catch {}
  const entries: AgentMemoryEntry[] = []
  let totalBytes = 0
  for (const dirent of names) {
    if (dirent.isSymbolicLink()) continue
    const rel = relPath ? `${relPath}/${dirent.name}` : dirent.name
    const abs = path.join(absPath, dirent.name)
    const stat = statOrNull(abs)
    if (!stat) continue
    if (dirent.isDirectory()) {
      let entryCount = 0
      try {
        entryCount = fs.readdirSync(abs).length
      } catch {}
      entries.push({path: rel, type: 'dir', size: 0, updatedAt: Math.round(stat.mtimeMs), entryCount})
    } else if (dirent.isFile()) {
      totalBytes += stat.size
      entries.push(fileEntry(rel, stat))
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {path: relPath, entries, totalBytes}
}

/**
 * Reads one memory file. Files that decode as clean UTF-8 come back as text
 * (`encoding: 'utf8'`, `content`); everything else comes back as raw bytes
 * (`encoding: 'binary'`, `data`).
 */
export function readMemoryFile(stateDir: string, rawPath: unknown): AgentMemoryFileData {
  const {relPath, absPath} = resolveMemoryPath(stateDir, rawPath)
  const stat = lstatOrNull(absPath)
  if (!stat || stat.isSymbolicLink()) throw new AgentMemoryError(404, `Memory file not found: ${relPath}`)
  if (stat.isDirectory()) throw new AgentMemoryError(400, `Memory path is a directory, not a file: ${relPath}`)
  const bytes = fs.readFileSync(absPath)
  const base = {
    path: relPath,
    size: stat.size,
    updatedAt: Math.round(stat.mtimeMs),
    mimeType: inferMimeType(relPath),
  }
  const text = decodeUtf8OrNull(bytes)
  if (text !== null) return {...base, encoding: 'utf8', content: text}
  return {...base, encoding: 'binary', data: new Uint8Array(bytes)}
}

/**
 * Writes one memory file, creating parent directories as needed. String content is written as
 * UTF-8 text; `Uint8Array` content is written verbatim.
 */
export function writeMemoryFile(stateDir: string, rawPath: unknown, content: unknown): AgentMemoryEntry {
  let contentBytes: Uint8Array
  if (typeof content === 'string') {
    contentBytes = new TextEncoder().encode(content)
  } else if (content instanceof Uint8Array) {
    contentBytes = content
  } else {
    throw new AgentMemoryError(400, 'Memory file content must be a string or bytes')
  }
  const {relPath, absPath} = resolveMemoryPath(stateDir, rawPath)
  return writeMemoryBytes(relPath, absPath, contentBytes)
}

/** Shared write path used by text/binary writes and web downloads after content is in hand. */
function writeMemoryBytes(relPath: string, absPath: string, contentBytes: Uint8Array): AgentMemoryEntry {
  const existing = lstatOrNull(absPath)
  if (existing?.isSymbolicLink()) throw new AgentMemoryError(400, `Memory path is not writable: ${relPath}`)
  if (existing?.isDirectory()) throw new AgentMemoryError(400, `Memory path is a directory, not a file: ${relPath}`)

  fs.mkdirSync(path.dirname(absPath), {recursive: true})
  fs.writeFileSync(absPath, contentBytes)
  const stat = fs.statSync(absPath)
  return fileEntry(relPath, stat)
}

/**
 * Downloads a web URL into the agent's memory. When `rawPath` is omitted, the file is stored under
 * `downloads/` named from the URL; when the chosen path has no extension, one is added from the
 * response content type when recognized. Downloads of any size are allowed; the stream is only
 * aborted when it stalls for {@link MEMORY_DOWNLOAD_IDLE_TIMEOUT_MS}.
 */
export async function downloadToMemory(
  stateDir: string,
  rawUrl: unknown,
  rawPath: unknown,
): Promise<AgentMemoryDownloadResult> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new AgentMemoryError(400, 'Download URL is required')
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new AgentMemoryError(400, `Invalid download URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AgentMemoryError(400, 'Download URL must use http or https')
  }

  const controller = new AbortController()
  let timeout = setTimeout(() => controller.abort(), MEMORY_DOWNLOAD_IDLE_TIMEOUT_MS)
  const resetIdleTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => controller.abort(), MEMORY_DOWNLOAD_IDLE_TIMEOUT_MS)
  }
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {'User-Agent': 'SeedAgents/1.0 (+https://seed.hyper.media)'},
    })
  } catch (error) {
    clearTimeout(timeout)
    throw new AgentMemoryError(
      502,
      `Could not download ${url}: ${error instanceof Error ? error.message : 'request failed'}`,
    )
  }
  if (!response.ok) {
    clearTimeout(timeout)
    throw new AgentMemoryError(502, `Could not download ${url}: HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? undefined
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    if (response.body) {
      const reader = response.body.getReader()
      for (;;) {
        resetIdleTimeout()
        const {done, value} = await reader.read()
        if (done) break
        if (value) {
          received += value.byteLength
          chunks.push(value)
        }
      }
    } else {
      const bytes = new Uint8Array(await response.arrayBuffer())
      received = bytes.byteLength
      chunks.push(bytes)
    }
  } catch (error) {
    throw new AgentMemoryError(
      502,
      `Download of ${url} failed: ${error instanceof Error ? error.message : 'stream error'}`,
    )
  } finally {
    clearTimeout(timeout)
  }

  const content = concatBytes(chunks, received)
  const relPathInput = rawPath === undefined || rawPath === null || rawPath === '' ? defaultDownloadPath(url) : rawPath
  let {relPath, absPath} = resolveMemoryPath(stateDir, relPathInput)
  if (!/\.[A-Za-z0-9]{1,8}$/.test(relPath) && contentType) {
    const ext = extensionForMimeType(contentType)
    if (ext) ({relPath, absPath} = resolveMemoryPath(stateDir, `${relPath}.${ext}`))
  }
  const entry = writeMemoryBytes(relPath, absPath, content)
  return {entry, finalUrl: response.url || url.toString(), contentType}
}

/** One root-level memory entry in the system-prompt summary. */
export type AgentMemoryTopLevelEntry = {
  name: string
  type: 'file' | 'dir'
  /** File size in bytes; total bytes of contained files for directories. */
  size: number
  /** Number of files inside, for directories. */
  fileCount?: number
}

/**
 * Summarizes the top level of the agent's memory for automatic system-prompt injection: root
 * files and directories (with contained file counts), without recursing into subfolder contents.
 */
export function summarizeMemoryTopLevel(stateDir: string): {
  entries: AgentMemoryTopLevelEntry[]
  totalFiles: number
  totalBytes: number
} {
  const {entries, totalBytes} = listMemory(stateDir)
  const top: AgentMemoryTopLevelEntry[] = []
  for (const entry of entries) {
    if (entry.path.includes('/')) continue
    if (entry.type === 'file') {
      top.push({name: entry.path, type: 'file', size: entry.size})
    } else {
      const inside = entries.filter((child) => child.type === 'file' && child.path.startsWith(`${entry.path}/`))
      top.push({
        name: entry.path,
        type: 'dir',
        size: inside.reduce((sum, child) => sum + child.size, 0),
        fileCount: inside.length,
      })
    }
  }
  return {entries: top, totalFiles: entries.filter((entry) => entry.type === 'file').length, totalBytes}
}

/** Deletes one memory file, or one directory recursively. Returns false when nothing existed. */
export function deleteMemoryPath(stateDir: string, rawPath: unknown): {path: string; deleted: boolean} {
  const {relPath, absPath} = resolveMemoryPath(stateDir, rawPath)
  const stat = lstatOrNull(absPath)
  if (!stat) return {path: relPath, deleted: false}
  fs.rmSync(absPath, {recursive: true, force: true})
  return {path: relPath, deleted: true}
}

/** Default memory path for a download without an explicit target: `downloads/<url filename>`. */
function defaultDownloadPath(url: URL): string {
  const lastSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
  const safe = lastSegment.replaceAll('\\', '-').replaceAll('..', '-').slice(0, 128)
  return `downloads/${safe || `download-${Date.now()}`}`
}

function fileEntry(relPath: string, stat: fs.Stats): AgentMemoryEntry {
  return {
    path: relPath,
    type: 'file',
    size: stat.size,
    updatedAt: Math.round(stat.mtimeMs),
    mimeType: inferMimeType(relPath),
  }
}

/** Decodes bytes as strict UTF-8 text, or returns null for binary content. */
function decodeUtf8OrNull(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
  } catch {
    return null
  }
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function statOrNull(target: string): fs.Stats | null {
  try {
    return fs.statSync(target)
  } catch {
    return null
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target)
  } catch {
    return null
  }
}
