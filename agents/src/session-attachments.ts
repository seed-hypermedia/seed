/**
 * Session-private file attachments.
 *
 * Files a user attaches to a session message live under
 * `<stateDir>/session-attachments/<sessionId>/`, beside (not inside) the agent's shared memory.
 * They are private to the session by design: the model sees them as metadata on the message and
 * pulls content on demand with the `view_attachment` tool; nothing is copied into cross-session
 * agent memory or published to IPFS unless the agent explicitly uses `attachment_to_memory` or
 * `attachment_to_ipfs`. Deleting the session deletes its attachments.
 *
 * Attachment ids are the SHA-256 hex of the content, so re-uploading the same file is idempotent
 * and references stay stable. Each attachment stores its raw bytes in `<id>.bin` and its metadata
 * (name, MIME type, timestamps) in `<id>.json`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {SessionAttachmentInfo} from '@seed-hypermedia/agents-protocol'
import {inferMimeType} from '@/agent-memory'

/** Name of the session attachments directory inside an agent's state directory. */
export const SESSION_ATTACHMENTS_DIR_NAME = 'session-attachments'

/** Maximum size of one session attachment. */
export const MAX_SESSION_ATTACHMENT_BYTES = 100 * 1024 * 1024
/** Maximum number of attachments per session. */
export const MAX_SESSION_ATTACHMENTS = 200
/** Maximum stored attachment name length in bytes. */
export const MAX_ATTACHMENT_NAME_BYTES = 256

/** Error raised for invalid attachment ids, names, or content. */
export class SessionAttachmentError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Returns the attachments root for one session, validating the session id shape. */
export function sessionAttachmentsDir(stateDir: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new SessionAttachmentError(400, 'Invalid session id')
  }
  return path.join(stateDir, SESSION_ATTACHMENTS_DIR_NAME, sessionId)
}

function attachmentPaths(stateDir: string, sessionId: string, id: string): {bin: string; meta: string} {
  if (!/^[0-9a-f]{64}$/.test(id)) throw new SessionAttachmentError(400, `Invalid attachment id: ${id}`)
  const dir = sessionAttachmentsDir(stateDir, sessionId)
  return {bin: path.join(dir, `${id}.bin`), meta: path.join(dir, `${id}.json`)}
}

/** Normalizes a client-supplied file name into a safe display name. */
function normalizeAttachmentName(rawName: unknown): string {
  const base = typeof rawName === 'string' ? rawName.trim().split(/[\\/]/).pop() ?? '' : ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!cleaned) return 'file'
  return Buffer.byteLength(cleaned) > MAX_ATTACHMENT_NAME_BYTES ? cleaned.slice(-64) : cleaned
}

/**
 * Stores one attachment for a session and returns its metadata. Idempotent for identical bytes:
 * the id is the SHA-256 of the content, and an existing attachment keeps its original metadata.
 */
export function saveSessionAttachment(
  stateDir: string,
  sessionId: string,
  input: {name: unknown; mimeType?: unknown; content: unknown},
): SessionAttachmentInfo {
  const content = input.content
  if (!(content instanceof Uint8Array) || content.byteLength === 0) {
    throw new SessionAttachmentError(400, 'Attachment content must be non-empty bytes')
  }
  if (content.byteLength > MAX_SESSION_ATTACHMENT_BYTES) {
    throw new SessionAttachmentError(
      413,
      `Attachment exceeds the ${Math.floor(MAX_SESSION_ATTACHMENT_BYTES / (1024 * 1024))} MiB limit`,
    )
  }
  const name = normalizeAttachmentName(input.name)
  const mimeType =
    typeof input.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : inferMimeType(name)

  const id = crypto.createHash('sha256').update(content).digest('hex')
  const {bin, meta} = attachmentPaths(stateDir, sessionId, id)
  const existing = readAttachmentMeta(meta)
  if (existing) return existing

  const dir = path.dirname(bin)
  fs.mkdirSync(dir, {recursive: true})
  const count = fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).length
  if (count >= MAX_SESSION_ATTACHMENTS) {
    throw new SessionAttachmentError(413, `Session already has ${MAX_SESSION_ATTACHMENTS} attachments`)
  }

  const info: SessionAttachmentInfo = {
    id,
    sessionId,
    name,
    ...(mimeType ? {mimeType} : {}),
    size: content.byteLength,
    createdAt: Date.now(),
  }
  fs.writeFileSync(bin, content)
  fs.writeFileSync(meta, JSON.stringify(info))
  return info
}

function readAttachmentMeta(metaPath: string): SessionAttachmentInfo | null {
  let raw: string
  try {
    raw = fs.readFileSync(metaPath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as SessionAttachmentInfo
    if (typeof parsed?.id === 'string' && typeof parsed?.size === 'number') return parsed
  } catch {
    // Corrupt sidecar: treat as missing so the attachment can be re-uploaded.
  }
  return null
}

/** Returns one attachment's metadata, or null when it does not exist. */
export function getSessionAttachmentInfo(
  stateDir: string,
  sessionId: string,
  attachmentId: string,
): SessionAttachmentInfo | null {
  const {meta} = attachmentPaths(stateDir, sessionId, attachmentId)
  return readAttachmentMeta(meta)
}

/** Returns one attachment's metadata and raw bytes. Throws 404 when it does not exist. */
export function readSessionAttachment(
  stateDir: string,
  sessionId: string,
  attachmentId: string,
): {info: SessionAttachmentInfo; data: Uint8Array} {
  const {bin, meta} = attachmentPaths(stateDir, sessionId, attachmentId)
  const info = readAttachmentMeta(meta)
  if (!info) throw new SessionAttachmentError(404, `Attachment not found: ${attachmentId}`)
  try {
    return {info, data: new Uint8Array(fs.readFileSync(bin))}
  } catch {
    throw new SessionAttachmentError(404, `Attachment content missing: ${attachmentId}`)
  }
}

/** Removes every attachment stored for a session. Safe to call when none exist. */
export function deleteSessionAttachments(stateDir: string, sessionId: string): void {
  fs.rmSync(sessionAttachmentsDir(stateDir, sessionId), {recursive: true, force: true})
}
