import {hmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {getSafeCurrentTab, getTabs} from './Tabs'

describe('getTabs', () => {
  it('shows comment versions instead of document changes for comment resources', () => {
    const tabs = getTabs({
      id: hmId('zComment', {path: ['zCommentId']}),
      resourceType: 'comment',
      versionCount: 3,
    })

    expect(tabs.map((tab) => tab.id)).toEqual(['document', 'versions', 'comments', 'capabilities', 'children'])
  })

  it('keeps the changes tab for documents', () => {
    const tabs = getTabs({
      id: hmId('zDoc', {path: ['notes']}),
      resourceType: 'document',
      changeCount: 2,
    })

    expect(tabs.map((tab) => tab.id)).toContain('changes')
    expect(tabs.map((tab) => tab.id)).not.toContain('versions')
  })
})

describe('getSafeCurrentTab', () => {
  it('falls back to document when the requested tab is unavailable', () => {
    const tabs = getTabs({
      id: hmId('zComment', {path: ['zCommentId']}),
      resourceType: 'comment',
      versionCount: 3,
    })

    expect(getSafeCurrentTab('changes', tabs)).toBe('document')
    expect(getSafeCurrentTab('citations', tabs)).toBe('document')
  })
})
