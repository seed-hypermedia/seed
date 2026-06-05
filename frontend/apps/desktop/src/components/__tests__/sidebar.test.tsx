import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {isSiteDocumentsActiveRoute} from '../sidebar-active'

describe('isSiteDocumentsActiveRoute', () => {
  const siteId = hmId('site')

  it('marks child documents for the site active', () => {
    expect(isSiteDocumentsActiveRoute({key: 'document', id: hmId('site', {path: ['docs', 'intro']})}, siteId)).toBe(
      true,
    )
  })

  it('marks document views for the site active', () => {
    expect(isSiteDocumentsActiveRoute({key: 'all-documents', id: siteId}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'comments', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'activity', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'directory', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'collaborators', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'feed', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
  })

  it('does not mark unrelated sites or non-document routes active', () => {
    expect(isSiteDocumentsActiveRoute({key: 'document', id: hmId('other', {path: ['docs']})}, siteId)).toBe(false)
    expect(isSiteDocumentsActiveRoute({key: 'profile', id: siteId}, siteId)).toBe(false)
    expect(isSiteDocumentsActiveRoute({key: 'library'}, siteId)).toBe(false)
  })
})
