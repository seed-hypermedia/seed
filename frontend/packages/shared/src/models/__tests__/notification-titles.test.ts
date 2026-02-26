import {describe, expect, it} from 'vitest'
import type {HMMetadata, UnpackedHypermediaId} from '../../hm-types'
import {getMentionNotificationTitle, getNotificationDocumentName} from '../notification-titles'

function targetPath(path: string[] | null): Pick<UnpackedHypermediaId, 'path'> {
  return {path}
}

function targetMeta(name?: string): HMMetadata {
  return {name} as HMMetadata
}

describe('notification titles helpers', () => {
  it('prefers metadata name when available', () => {
    const name = getNotificationDocumentName({
      targetMeta: targetMeta('My Doc'),
      targetId: targetPath(['fallback']),
    })
    expect(name).toBe('My Doc')
  })

  it('falls back to target path segment when metadata name is missing', () => {
    const name = getNotificationDocumentName({
      targetMeta: targetMeta(),
      targetId: targetPath(['docs', 'my-post']),
    })
    expect(name).toBe('my-post')
  })

  it('falls back to untitled document when both name and path are missing', () => {
    const name = getNotificationDocumentName({
      targetMeta: targetMeta(),
      targetId: targetPath(null),
    })
    expect(name).toBe('Untitled Document')
  })

  it('always includes document name in mention title', () => {
    const title = getMentionNotificationTitle({
      actorName: 'Alice',
      subjectName: 'you',
      documentName: 'Roadmap',
    })
    expect(title).toBe('Alice mentioned you in Roadmap')
  })
})
