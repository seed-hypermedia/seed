import type {HMResource} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {resolveCommentTargetVersion} from './comment-target-version'

const UID = 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'
const TARGET_VERSION = 'bafy2bzacebv6kknxlon574q7h3v5qoujjg3hucr5e2gcvl3g4vgxgwfjhkjre'

function documentResource(version: string): HMResource {
  return {type: 'document', id: hmId(UID, {path: ['for-julio']}), document: {version} as any} as HMResource
}

describe('resolveCommentTargetVersion', () => {
  it('uses the resolved document version when the route id is unpinned (republish)', () => {
    const docId = hmId(UID, {path: ['for-julio'], latest: true})
    expect(docId.version).toBeNull()
    expect(resolveCommentTargetVersion(docId, documentResource(TARGET_VERSION))).toBe(TARGET_VERSION)
  })

  it('falls back to the id version while the resource has not resolved', () => {
    const docId = hmId(UID, {path: ['notes'], version: 'bafyreiabc'})
    expect(resolveCommentTargetVersion(docId, undefined)).toBe('bafyreiabc')
    expect(resolveCommentTargetVersion(docId, {type: 'not-found', id: docId} as HMResource)).toBe('bafyreiabc')
  })

  it('is undefined when neither the id nor the resource carries a version', () => {
    const docId = hmId(UID, {path: ['for-julio'], latest: true})
    expect(resolveCommentTargetVersion(docId, undefined)).toBeUndefined()
    expect(resolveCommentTargetVersion(docId, {type: 'not-found', id: docId} as HMResource)).toBeUndefined()
  })
})
