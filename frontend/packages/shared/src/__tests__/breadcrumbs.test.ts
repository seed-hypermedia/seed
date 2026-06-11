import {describe, expect, it} from 'vitest'
import {getDraftPlaceholderParentId} from '../utils/breadcrumbs'
import {hmId} from '../utils/entity-id-url'

describe('getDraftPlaceholderParentId', () => {
  it('returns the parent document id for public draft placeholder routes', () => {
    expect(getDraftPlaceholderParentId(hmId('acc', {path: ['parent', '-draft-1']}), 'draft-1')).toEqual(
      hmId('acc', {path: ['parent']}),
    )
  })

  it('returns the parent document id for private draft placeholder routes', () => {
    expect(getDraftPlaceholderParentId(hmId('acc', {path: ['parent', '-private-draft-1']}), 'draft-1')).toEqual(
      hmId('acc', {path: ['parent']}),
    )
  })

  it('does not redirect published-document draft routes', () => {
    expect(getDraftPlaceholderParentId(hmId('acc', {path: ['published']}), 'draft-1')).toBeNull()
  })

  it('does not redirect a different draft placeholder id', () => {
    expect(getDraftPlaceholderParentId(hmId('acc', {path: ['parent', '-other-draft']}), 'draft-1')).toBeNull()
  })
})
