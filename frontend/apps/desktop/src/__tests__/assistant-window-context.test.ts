import {describe, expect, it, vi} from 'vitest'

// The hook half of the module needs shared model/navigation providers; the formatter under test
// is pure.
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: undefined})}))
vi.mock('@shm/shared/utils/navigation', () => ({useNavRoute: () => ({key: 'library'})}))

import {deriveAssistantWindowContext, formatWindowContextLines} from '../components/assistant-window-context'

/**
 * The window-context lines attached to assistant sends.
 *
 * This is the payload that makes "summarize this" resolve to the open document — the old
 * assistant runtime built the same lines into its system prompt, and losing any of them silently
 * degrades the model's answers rather than erroring.
 */
describe('formatWindowContextLines', () => {
  it('describes a document window with focus and panel state', () => {
    const lines = formatWindowContextLines({
      url: 'hm://z6MkDoc/plan',
      title: 'The Plan',
      view: 'document',
      activePanel: 'comments',
      openComment: 'comment-9',
      focusedBlockId: 'block-3',
      focusedBlockRange: {start: 4, end: 9},
    })
    expect(lines).toEqual([
      '## Current window',
      'URL: hm://z6MkDoc/plan',
      'Title: "The Plan"',
      'View: document',
      'Side panel: comments',
      'Open comment: comment-9',
      'Focused block: block-3[4:9]',
      'Treat this as the default referent when the user says "this document", "this comment", etc. Use `read` to verify content before answering.',
    ])
  })

  it('describes a draft window without a published URL', () => {
    const lines = formatWindowContextLines({
      view: 'draft',
      isDraft: true,
      editingDocumentUrl: 'hm://z6MkDoc/plan',
    })
    expect(lines).toContain('The user is editing a draft.')
    expect(lines).toContain('Editing document: hm://z6MkDoc/plan')
  })

  it('sends nothing for windows with no document referent', () => {
    // A context part with no referent is pure token noise on every send.
    expect(formatWindowContextLines(undefined)).toBeUndefined()
    expect(formatWindowContextLines({view: 'feed'})).toBeUndefined()
  })
})

describe('deriveAssistantWindowContext', () => {
  const docId = {
    id: 'hm://z6MkDoc/employees',
    uid: 'z6MkDoc',
    path: ['employees'],
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    latest: true,
    scheme: null,
  }

  it('describes the attributes tab, which routes as `metadata`', () => {
    // Regression: the attributes view sent no context at all, so the agent had no idea the user
    // was looking at a document's attributes.
    const context = deriveAssistantWindowContext({key: 'metadata', id: docId} as never, 'Employees')
    expect(context?.view).toBe('attributes')
    expect(context?.url).toBe('hm://z6MkDoc/employees')
    const lines = formatWindowContextLines(context)
    expect(lines).toContain('View: attributes')
    expect(lines).toContain('Title: "Employees"')
  })

  it('describes the plain document view', () => {
    const context = deriveAssistantWindowContext({key: 'document', id: docId} as never, 'Employees')
    expect(context?.view).toBe('document')
    expect(context?.url).toBe('hm://z6MkDoc/employees')
  })
})
