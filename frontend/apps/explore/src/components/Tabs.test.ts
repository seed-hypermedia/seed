import {hmId} from '@shm/shared'
import {describe, expect, it} from 'vitest'
import {getSafeCurrentTab, getTabs} from './Tabs'

describe('getTabs', () => {
  it('shows comment versions and citations instead of document changes for comment resources, and hides capabilities/children', () => {
    const tabs = getTabs({
      id: hmId('zComment', {path: ['zCommentId']}),
      resourceType: 'comment',
      versionCount: 3,
      citationCount: 2,
    })

    // Comments have no capabilities or children; their comments tab lists replies.
    expect(tabs.map((tab) => tab.id)).toEqual(['document', 'versions', 'comments', 'citations'])
  })

  it('labels the state tab "Comment State" and the comments tab "Replies" for comments', () => {
    const tabs = getTabs({
      id: hmId('zComment', {path: ['zCommentId']}),
      resourceType: 'comment',
      commentCount: 2,
    })

    const byId = Object.fromEntries(tabs.map((tab) => [tab.id, tab.label]))
    expect(byId.document).toBe('Comment State')
    expect(byId.comments).toBe('2 Replies')
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
    expect(getSafeCurrentTab('citations', tabs)).toBe('citations')
  })
})
