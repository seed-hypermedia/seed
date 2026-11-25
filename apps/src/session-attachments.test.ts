import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as sessionAttachments from '@/session-attachments'

const tempDirs: string[] = []

function createStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-session-attachments-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, {recursive: true, force: true})
})

describe('session attachments', () => {
  test('saves, reads, and deduplicates attachments by content hash', () => {
    const stateDir = createStateDir()
    const content = new TextEncoder().encode('hello attachment')
    const saved = sessionAttachments.saveSessionAttachment(stateDir, 'session-1', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      content,
    })
    expect(saved.id).toMatch(/^[0-9a-f]{64}$/)
    expect(saved).toMatchObject({
      sessionId: 'session-1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: content.length,
    })

    // Same bytes → same id, original metadata kept even with a different name.
    const again = sessionAttachments.saveSessionAttachment(stateDir, 'session-1', {
      name: 'renamed.txt',
      content,
    })
    expect(again.id).toBe(saved.id)
    expect(again.name).toBe('notes.txt')

    const {info, data} = sessionAttachments.readSessionAttachment(stateDir, 'session-1', saved.id)
    expect(info.id).toBe(saved.id)
    expect(new TextDecoder().decode(data)).toBe('hello attachment')
    expect(sessionAttachments.getSessionAttachmentInfo(stateDir, 'session-1', saved.id)?.name).toBe('notes.txt')
  })

  test('scopes attachments to their session and infers mime from the name', () => {
    const stateDir = createStateDir()
    const saved = sessionAttachments.saveSessionAttachment(stateDir, 'session-a', {
      name: 'photo.png',
      content: new Uint8Array([1, 2, 3]),
    })
    expect(saved.mimeType).toBe('image/png')
    // Another session cannot read it.
    expect(sessionAttachments.getSessionAttachmentInfo(stateDir, 'session-b', saved.id)).toBeNull()
    expect(() => sessionAttachments.readSessionAttachment(stateDir, 'session-b', saved.id)).toThrow(
      'Attachment not found',
    )
  })

  test('rejects invalid ids, session ids, and empty content', () => {
    const stateDir = createStateDir()
    expect(() =>
      sessionAttachments.saveSessionAttachment(stateDir, 'bad/../session', {name: 'x', content: new Uint8Array([1])}),
    ).toThrow('Invalid session id')
    expect(() =>
      sessionAttachments.saveSessionAttachment(stateDir, 'session-1', {name: 'x', content: new Uint8Array()}),
    ).toThrow('non-empty bytes')
    expect(() => sessionAttachments.readSessionAttachment(stateDir, 'session-1', 'not-a-hash')).toThrow(
      'Invalid attachment id',
    )
  })

  test('sanitizes path-ish names to their base name', () => {
    const stateDir = createStateDir()
    const saved = sessionAttachments.saveSessionAttachment(stateDir, 'session-1', {
      name: '../../etc/passwd',
      content: new Uint8Array([9]),
    })
    expect(saved.name).toBe('passwd')
  })

  test('deleteSessionAttachments removes everything for the session only', () => {
    const stateDir = createStateDir()
    const a = sessionAttachments.saveSessionAttachment(stateDir, 'session-a', {
      name: 'a.txt',
      content: new Uint8Array([1]),
    })
    const b = sessionAttachments.saveSessionAttachment(stateDir, 'session-b', {
      name: 'b.txt',
      content: new Uint8Array([2]),
    })
    sessionAttachments.deleteSessionAttachments(stateDir, 'session-a')
    expect(sessionAttachments.getSessionAttachmentInfo(stateDir, 'session-a', a.id)).toBeNull()
    expect(sessionAttachments.getSessionAttachmentInfo(stateDir, 'session-b', b.id)?.name).toBe('b.txt')
  })
})
