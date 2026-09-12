import {describe, expect, it} from 'vitest'
import {isPrivateDocumentDenied} from '../private-document-access'

describe('isPrivateDocumentDenied', () => {
  it('denies private content without selected-account access', () => {
    expect(isPrivateDocumentDenied('PRIVATE', false)).toBe(true)
  })
  it('allows private content for an owner or collaborator', () => {
    expect(isPrivateDocumentDenied('PRIVATE', true)).toBe(false)
  })
  it('never hides public content', () => {
    expect(isPrivateDocumentDenied('PUBLIC', false)).toBe(false)
  })
})
