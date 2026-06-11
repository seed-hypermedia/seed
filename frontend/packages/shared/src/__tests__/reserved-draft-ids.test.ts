import {describe, expect, it} from 'vitest'
import {
  getReservedLazyDraftBreadcrumbName,
  isReservedLazyDraftId,
  rememberReservedLazyDraftId,
} from '../utils/reserved-draft-ids'

describe('reserved lazy draft ids', () => {
  it('remembers ids preallocated by new-document navigation', () => {
    expect(isReservedLazyDraftId('lazy-route-draft')).toBe(false)

    rememberReservedLazyDraftId('lazy-route-draft')

    expect(isReservedLazyDraftId('lazy-route-draft')).toBe(true)
  })
})

it('returns stable breadcrumb labels for preallocated public/private draft paths', () => {
  rememberReservedLazyDraftId('public-draft')
  rememberReservedLazyDraftId('private-draft')

  expect(getReservedLazyDraftBreadcrumbName('-public-draft')).toBe('New Document')
  expect(getReservedLazyDraftBreadcrumbName('-private-private-draft')).toBe('New Private Document')
  expect(getReservedLazyDraftBreadcrumbName('-unknown-draft')).toBeNull()
})

it('returns stable breadcrumb labels for the active reserved draft id even after registry state is missing', () => {
  expect(getReservedLazyDraftBreadcrumbName('-refreshed-public-draft', 'refreshed-public-draft')).toBe('New Document')
  expect(getReservedLazyDraftBreadcrumbName('-private-refreshed-private-draft', 'refreshed-private-draft')).toBe(
    'New Private Document',
  )
})
