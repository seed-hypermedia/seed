import {describe, expect, it} from 'vitest'
import {getDocumentSelectionObserverKey, shouldCancelEditOnOutsidePointer} from './document-editor'

describe('getDocumentSelectionObserverKey', () => {
  it('returns a key for collapsed selections', () => {
    expect(getDocumentSelectionObserverKey({from: 12, to: 12})).toBe('12:12')
  })

  it('returns a key for range selections', () => {
    expect(getDocumentSelectionObserverKey({from: 12, to: 18})).toBe('12:18')
  })
})

describe('shouldCancelEditOnOutsidePointer', () => {
  it('does not cancel editing while changes are unsaved or saving', () => {
    expect(shouldCancelEditOnOutsidePointer('changed')).toBe(false)
    expect(shouldCancelEditOnOutsidePointer('saving')).toBe(false)
  })

  it('allows outside pointer cancellation when content is idle or saved', () => {
    expect(shouldCancelEditOnOutsidePointer('idle')).toBe(true)
    expect(shouldCancelEditOnOutsidePointer('saved')).toBe(true)
  })
})
