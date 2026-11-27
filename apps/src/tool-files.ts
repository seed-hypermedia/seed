/**
 * Files inside a tool's JSON.
 *
 * A tool takes and returns JSON only. A file travels in that JSON as an object with exactly three
 * fields, `{name, mimeType, data}`, where `data` is the bytes as base64 (hypermedia/tool.md). This
 * module finds those objects and says what a public call record may keep of a value.
 */

import type * as api from '@/api'

/** The most bytes of JSON one tool call takes as input. */
export const MAX_TOOL_INPUT_BYTES = 64 * 1024 * 1024
/** The most bytes of JSON one tool call returns. */
export const MAX_TOOL_OUTPUT_BYTES = 128 * 1024 * 1024
/** The most bytes of JSON a call record keeps of an input or an output. */
export const MAX_RECORDED_VALUE_BYTES = 64 * 1024
/** A string longer than this is the first thing left out of a value too large to record. */
const MAX_RECORDED_STRING_BYTES = 1024

const FILE_KEYS = ['data', 'mimeType', 'name']

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a value is a file: an object with a string `name`, `mimeType` and `data`, and nothing else. */
export function isToolFile(value: unknown): value is api.AppToolFile {
  if (!isPlainObject(value)) return false
  const keys = Object.keys(value).sort()
  return (
    keys.length === FILE_KEYS.length && keys.every((key, i) => key === FILE_KEYS[i] && typeof value[key] === 'string')
  )
}

/** The size of a file's bytes, read off its base64 without decoding it. */
export function toolFileSize(file: api.AppToolFile): number {
  return Buffer.byteLength(file.data, 'base64')
}

/** A relative, slash-separated file path that stays inside its folder, or null. */
export function safeFilePath(raw: string): string | null {
  const segments = raw.replace(/\\/g, '/').split('/')
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  return segments.join('/')
}

/** A copy of a JSON value with every file replaced by what `replace` returns for it. */
export function replaceToolFiles(value: unknown, replace: (file: api.AppToolFile) => unknown): unknown {
  if (isToolFile(value)) return replace(value)
  if (Array.isArray(value)) return value.map((item) => replaceToolFiles(item, replace))
  if (isPlainObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceToolFiles(item, replace)]))
  return value
}

function withoutLongStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value)
    return bytes > MAX_RECORDED_STRING_BYTES ? `[${bytes} bytes not recorded]` : value
  }
  if (Array.isArray(value)) return value.map(withoutLongStrings)
  if (isPlainObject(value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutLongStrings(item)]))
  return value
}

/**
 * What a call record keeps of an input or an output, as JSON text. Call records are public, so a
 * file is recorded as its name, type and size, never its bytes. A value still longer than
 * {@link MAX_RECORDED_VALUE_BYTES} loses its long strings, and one that is long even then is
 * recorded as its size alone.
 */
export function recordedJson(value: unknown): string {
  const withoutFiles = replaceToolFiles(
    value ?? null,
    (file): api.AppToolFileInfo => ({name: file.name, mimeType: file.mimeType, size: toolFileSize(file)}),
  )
  const json = JSON.stringify(withoutFiles)
  if (Buffer.byteLength(json) <= MAX_RECORDED_VALUE_BYTES) return json
  const shortened = JSON.stringify(withoutLongStrings(withoutFiles))
  if (Buffer.byteLength(shortened) <= MAX_RECORDED_VALUE_BYTES) return shortened
  return JSON.stringify(`[${Buffer.byteLength(json)} bytes not recorded]`)
}
