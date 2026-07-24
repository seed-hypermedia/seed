/**
 * Per-agent persistent memory filesystem.
 *
 * Every agent owns a private directory at `<stateDir>/memory`. Agent sessions read and write it
 * through the `memory_*` tools, and users get full read/write access through the signed
 * `*AgentMemory*` actions rendered in the desktop Memory tab. All paths are relative to the memory
 * root and are strictly sandboxed: no absolute paths, no `..` traversal, no symlink targets.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** Name of the memory directory inside an agent's state directory. */
export const MEMORY_DIR_NAME = 'memory'

/** Maximum size of a single memory file in bytes. */
export const MAX_MEMORY_FILE_BYTES = 1024 * 1024
/** Maximum total bytes across all files in one agent's memory. */
export const MAX_MEMORY_TOTAL_BYTES = 100 * 1024 * 1024
/** Maximum number of entries (files + directories) in one agent's memory. */
export const MAX_MEMORY_ENTRIES = 2_000
/** Maximum length of a normalized relative memory path in bytes. */
export const MAX_MEMORY_PATH_BYTES = 512
/** Maximum directory nesting depth of a memory path. */
export const MAX_MEMORY_PATH_DEPTH = 16

/** One file or directory inside an agent's memory. */
export type AgentMemoryEntry = {
  /** Relative path from the memory root, always `/`-separated. */
  path: string
  type: 'file' | 'dir'
  /** File size in bytes; 0 for directories. */
  size: number
  /** Last modification time in Unix epoch milliseconds. */
  updatedAt: number
}

/** Contents of one memory file. */
export type AgentMemoryFile = {
  path: string
  content: string
  size: number
  updatedAt: number
}

/** Error raised for invalid memory paths or violated memory limits. */
export class AgentMemoryError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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
      if (entries.length >= MAX_MEMORY_ENTRIES) return
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
        entries.push({path: rel, type: 'file', size: stat.size, updatedAt: Math.round(stat.mtimeMs)})
      }
    }
  }
  walk(root, '')
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {entries, totalBytes}
}

/** Reads one memory file as UTF-8 text. */
export function readMemoryFile(stateDir: string, rawPath: unknown): AgentMemoryFile {
  const {relPath, absPath} = resolveMemoryPath(stateDir, rawPath)
  const stat = lstatOrNull(absPath)
  if (!stat || stat.isSymbolicLink()) throw new AgentMemoryError(404, `Memory file not found: ${relPath}`)
  if (stat.isDirectory()) throw new AgentMemoryError(400, `Memory path is a directory, not a file: ${relPath}`)
  if (stat.size > MAX_MEMORY_FILE_BYTES) throw new AgentMemoryError(400, `Memory file is too large to read: ${relPath}`)
  const content = fs.readFileSync(absPath, 'utf8')
  return {path: relPath, content, size: stat.size, updatedAt: Math.round(stat.mtimeMs)}
}

/** Writes one memory file as UTF-8 text, creating parent directories as needed. */
export function writeMemoryFile(stateDir: string, rawPath: unknown, content: unknown): AgentMemoryEntry {
  if (typeof content !== 'string') throw new AgentMemoryError(400, 'Memory file content must be a string')
  const {relPath, absPath} = resolveMemoryPath(stateDir, rawPath)
  const contentBytes = new TextEncoder().encode(content)
  if (contentBytes.byteLength > MAX_MEMORY_FILE_BYTES) {
    throw new AgentMemoryError(400, `Memory file content exceeds the ${MAX_MEMORY_FILE_BYTES} byte limit`)
  }
  const existing = lstatOrNull(absPath)
  if (existing?.isSymbolicLink()) throw new AgentMemoryError(400, `Memory path is not writable: ${relPath}`)
  if (existing?.isDirectory()) throw new AgentMemoryError(400, `Memory path is a directory, not a file: ${relPath}`)

  const {entries, totalBytes} = listMemory(stateDir)
  const previousSize = existing?.isFile() ? existing.size : 0
  if (totalBytes - previousSize + contentBytes.byteLength > MAX_MEMORY_TOTAL_BYTES) {
    throw new AgentMemoryError(400, 'Agent memory is full')
  }
  if (!existing && entries.length >= MAX_MEMORY_ENTRIES) {
    throw new AgentMemoryError(400, 'Agent memory has too many files')
  }

  fs.mkdirSync(path.dirname(absPath), {recursive: true})
  fs.writeFileSync(absPath, contentBytes)
  const stat = fs.statSync(absPath)
  return {path: relPath, type: 'file', size: stat.size, updatedAt: Math.round(stat.mtimeMs)}
}

/** Deletes one memory file, or one directory recursively. Returns false when nothing existed. */
export function deleteMemoryPath(stateDir: string, rawPath: unknown): {path: string; deleted: boolean} {
  const {relPath, absPath} = resolveMemoryPath(stateDir, rawPath)
  const stat = lstatOrNull(absPath)
  if (!stat) return {path: relPath, deleted: false}
  fs.rmSync(absPath, {recursive: true, force: true})
  return {path: relPath, deleted: true}
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
