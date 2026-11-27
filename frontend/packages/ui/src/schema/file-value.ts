// A file inside a JSON value: an object with exactly a `name`, a `mimeType` and `data`, the bytes as
// base64. It is how a tool takes and returns files (hypermedia/tool.md). The schema form draws a
// file picker for a struct of that shape, and a tool's result offers each such object for saving.
import type {AppToolFile, AppToolFileInfo} from '@seed-hypermedia/apps-protocol'

const FILE_KEYS = ['data', 'mimeType', 'name']

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The names of a file's three fields, sorted, for telling a file-shaped struct schema from any other. */
export const FILE_FIELD_NAMES: readonly string[] = FILE_KEYS

/** Whether a value is a file: an object with a string `name`, `mimeType` and `data`, and nothing else. */
export function isFileValue(value: unknown): value is AppToolFile {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  return (
    keys.length === FILE_KEYS.length && keys.every((key, i) => key === FILE_KEYS[i] && typeof value[key] === 'string')
  )
}

/** A file field nobody has picked a file for yet. */
export const EMPTY_FILE: AppToolFile = {name: '', mimeType: '', data: ''}

/** Whether a value holds a file field that is still empty, at any depth. */
export function hasEmptyFile(value: unknown): boolean {
  if (isFileValue(value)) return value.data === ''
  if (Array.isArray(value)) return value.some(hasEmptyFile)
  if (isRecord(value)) return Object.values(value).some(hasEmptyFile)
  return false
}

/** The size in bytes of what a base64 string encodes. */
export function base64Size(data: string): number {
  const length = data.length
  if (!length) return 0
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.floor((length * 3) / 4) - padding
}

/**
 * Splits a value into what to show and the files in it. Each file is replaced, in `shown`, by its
 * name, type and size, which is also how a recorded call holds it.
 */
export function splitFiles(value: unknown): {shown: unknown; files: AppToolFile[]} {
  const files: AppToolFile[] = []
  const walk = (item: unknown): unknown => {
    if (isFileValue(item)) {
      files.push(item)
      return {name: item.name, mimeType: item.mimeType, size: base64Size(item.data)} satisfies AppToolFileInfo
    }
    if (Array.isArray(item)) return item.map(walk)
    if (isRecord(item)) return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, walk(inner)]))
    return item
  }
  return {shown: walk(value), files}
}

/** The name of a file as a value shows it: a file with its bytes, or the record of one. */
export function fileNameOf(value: unknown): string | undefined {
  if (isFileValue(value)) return value.name
  if (isRecord(value) && typeof value.name === 'string' && typeof value.mimeType === 'string' && 'size' in value)
    return value.name
  return undefined
}

/** Reads a file the person picked into the form a tool takes it in. Nothing is uploaded or stored. */
export function readFileValue(file: File): Promise<AppToolFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: url.slice(url.indexOf(',') + 1),
      })
    }
    reader.readAsDataURL(file)
  })
}

/** A size for people: `812 B`, `34 KB`, `2.1 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
