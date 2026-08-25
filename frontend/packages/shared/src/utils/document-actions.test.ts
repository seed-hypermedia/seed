import {describe, expect, it} from 'vitest'
import {hmId} from './entity-id-url'
import {
  canShowMoveDocumentAction,
  canShowRepublishDocumentAction,
  canUseDocumentAsDestinationParent,
  isMoveTargetParentBlocked,
  isMoveTargetSameSpace,
  canUseMoveTargetParent,
} from './document-actions'

describe('document action visibility', () => {
  it('hides move and republish for home documents', () => {
    const homeId = hmId('space-a')

    expect(canShowMoveDocumentAction({id: homeId, selectedAccountUid: 'space-a', canWriteSource: true})).toBe(false)
    expect(canShowRepublishDocumentAction({id: homeId, selectedAccountUid: 'space-a'})).toBe(false)
  })

  it('shows republish for signed-in users without requiring source write access', () => {
    const docId = hmId('space-a', {path: ['docs', 'api']})

    expect(canShowRepublishDocumentAction({id: docId, selectedAccountUid: 'writer-b'})).toBe(true)
  })

  it('shows move only for non-root documents when the selected account can write the source', () => {
    const docId = hmId('space-a', {path: ['docs', 'api']})

    expect(canShowMoveDocumentAction({id: docId, selectedAccountUid: 'writer-b', canWriteSource: true})).toBe(true)
    expect(canShowMoveDocumentAction({id: docId, selectedAccountUid: 'writer-b', canWriteSource: false})).toBe(false)
    expect(canShowMoveDocumentAction({id: docId, selectedAccountUid: null, canWriteSource: true})).toBe(false)
  })
})

describe('move target validation', () => {
  it('blocks moving a document into itself or one of its descendants', () => {
    const sourceId = hmId('space-a', {path: ['specs']})

    expect(isMoveTargetParentBlocked(sourceId, hmId('space-a', {path: ['specs']}))).toBe(true)
    expect(isMoveTargetParentBlocked(sourceId, hmId('space-a', {path: ['specs', 'api']}))).toBe(true)
    expect(isMoveTargetParentBlocked(sourceId, hmId('space-a', {path: ['design']}))).toBe(false)
    expect(isMoveTargetParentBlocked(sourceId, hmId('space-b', {path: ['specs', 'api']}))).toBe(false)
  })

  it('keeps move targets inside the source space', () => {
    const sourceId = hmId('space-a', {path: ['docs', 'api']})

    expect(isMoveTargetSameSpace(sourceId, hmId('space-a', {path: ['docs']}))).toBe(true)
    expect(isMoveTargetSameSpace(sourceId, hmId('space-b', {path: ['docs']}))).toBe(false)
    expect(canUseMoveTargetParent(sourceId, hmId('space-a', {path: ['docs']}))).toBe(true)
    expect(canUseMoveTargetParent(sourceId, hmId('space-a', {path: ['docs', 'api']}))).toBe(false)
    expect(canUseMoveTargetParent(sourceId, hmId('space-b', {path: ['docs']}))).toBe(false)
  })

  it('excludes private documents as destination parents', () => {
    expect(canUseDocumentAsDestinationParent({visibility: 'PRIVATE'})).toBe(false)
    expect(canUseDocumentAsDestinationParent({visibility: 'PUBLIC'})).toBe(true)
  })
})
