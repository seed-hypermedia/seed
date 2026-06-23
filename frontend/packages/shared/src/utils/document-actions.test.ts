import {describe, expect, it} from 'vitest'
import {hmId} from './entity-id-url'
import {
  canShowMoveDocumentAction,
  canShowRepublishDocumentAction,
  canUseDocumentAsDestinationParent,
  isMoveTargetParentBlocked,
} from './document-actions'

describe('document action visibility', () => {
  it('hides move and republish for home documents', () => {
    const homeId = hmId('site-a')

    expect(canShowMoveDocumentAction({id: homeId, selectedAccountUid: 'site-a', canWriteSource: true})).toBe(false)
    expect(canShowRepublishDocumentAction({id: homeId, selectedAccountUid: 'site-a'})).toBe(false)
  })

  it('shows republish for signed-in users without requiring source write access', () => {
    const docId = hmId('site-a', {path: ['docs', 'api']})

    expect(canShowRepublishDocumentAction({id: docId, selectedAccountUid: 'writer-b'})).toBe(true)
  })

  it('shows move only for non-root documents when the selected account can write the source', () => {
    const docId = hmId('site-a', {path: ['docs', 'api']})

    expect(canShowMoveDocumentAction({id: docId, selectedAccountUid: 'writer-b', canWriteSource: true})).toBe(true)
    expect(canShowMoveDocumentAction({id: docId, selectedAccountUid: 'writer-b', canWriteSource: false})).toBe(false)
    expect(canShowMoveDocumentAction({id: docId, selectedAccountUid: null, canWriteSource: true})).toBe(false)
  })
})

describe('move target validation', () => {
  it('blocks moving a document into itself or one of its descendants', () => {
    const sourceId = hmId('site-a', {path: ['specs']})

    expect(isMoveTargetParentBlocked(sourceId, hmId('site-a', {path: ['specs']}))).toBe(true)
    expect(isMoveTargetParentBlocked(sourceId, hmId('site-a', {path: ['specs', 'api']}))).toBe(true)
    expect(isMoveTargetParentBlocked(sourceId, hmId('site-a', {path: ['design']}))).toBe(false)
    expect(isMoveTargetParentBlocked(sourceId, hmId('site-b', {path: ['specs', 'api']}))).toBe(false)
  })

  it('excludes private documents as destination parents', () => {
    expect(canUseDocumentAsDestinationParent({visibility: 'PRIVATE'})).toBe(false)
    expect(canUseDocumentAsDestinationParent({visibility: 'PUBLIC'})).toBe(true)
  })
})
