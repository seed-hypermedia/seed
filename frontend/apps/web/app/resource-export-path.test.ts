import {describe, expect, it} from 'vitest'
import {extractExportView, parseResourceExportPath} from './resource-export-path'

describe('parseResourceExportPath', () => {
  it('detects .md on the last segment', () => {
    expect(parseResourceExportPath(['guides', 'publishing.md'])).toEqual({
      format: 'markdown',
      pathParts: ['guides', 'publishing'],
    })
  })

  it('detects .json on the last segment', () => {
    expect(parseResourceExportPath(['guides', 'publishing.json'])).toEqual({
      format: 'json',
      pathParts: ['guides', 'publishing'],
    })
  })

  it('detects the extension on the document segment before a view term', () => {
    expect(parseResourceExportPath(['guides', 'publishing.md', ':attributes'])).toEqual({
      format: 'markdown',
      pathParts: ['guides', 'publishing', ':attributes'],
    })
    expect(parseResourceExportPath(['guides', 'publishing.json', ':activity', 'citations'])).toEqual({
      format: 'json',
      pathParts: ['guides', 'publishing', ':activity', 'citations'],
    })
  })

  it('detects the extension on a comment id after a view term', () => {
    expect(parseResourceExportPath(['docs', ':comments', 'z6MkUid', 'abc123.md'])).toEqual({
      format: 'markdown',
      pathParts: ['docs', ':comments', 'z6MkUid', 'abc123'],
    })
  })

  it('supports cross-account hm paths', () => {
    expect(parseResourceExportPath(['hm', 'z6MkUid', 'some-doc.md'])).toEqual({
      format: 'markdown',
      pathParts: ['hm', 'z6MkUid', 'some-doc'],
    })
  })

  it('supports the home document', () => {
    expect(parseResourceExportPath(['.md'])).toEqual({format: 'markdown', pathParts: []})
    expect(parseResourceExportPath(['.json', ':activity'])).toEqual({format: 'json', pathParts: [':activity']})
  })

  it('returns null when there is no export extension', () => {
    expect(parseResourceExportPath(['guides', 'publishing'])).toBeNull()
    expect(parseResourceExportPath([])).toBeNull()
  })

  it('ignores extensions on intermediate non-view segments', () => {
    expect(parseResourceExportPath(['guides.md', 'publishing'])).toBeNull()
  })

  it('never intercepts reserved hm app routes', () => {
    expect(parseResourceExportPath(['hm', 'api', 'file', 'notes.md'])).toBeNull()
    expect(parseResourceExportPath(['hm', 'agents', 'session', 'plan.md'])).toBeNull()
  })
})

describe('extractExportView', () => {
  it('returns the document view for plain paths', () => {
    expect(extractExportView(['guides', 'publishing'])).toEqual({
      docPathParts: ['guides', 'publishing'],
      view: {key: 'document'},
    })
  })

  it('extracts the attributes view as metadata', () => {
    expect(extractExportView(['guides', 'publishing', ':attributes'])).toEqual({
      docPathParts: ['guides', 'publishing'],
      view: {key: 'metadata'},
    })
  })

  it('extracts the comments view', () => {
    expect(extractExportView(['docs', ':comments'])).toEqual({
      docPathParts: ['docs'],
      view: {key: 'comments'},
    })
  })

  it('extracts a UID/TSID comment id', () => {
    expect(extractExportView(['docs', ':comments', 'z6MkUid', 'abc123'])).toEqual({
      docPathParts: ['docs'],
      view: {key: 'comments', commentId: 'z6MkUid/abc123'},
    })
  })

  it('extracts the activity view with a filter', () => {
    expect(extractExportView(['docs', ':activity', 'citations'])).toEqual({
      docPathParts: ['docs'],
      view: {key: 'activity', filterSlug: 'citations'},
    })
    expect(extractExportView(['docs', ':activity'])).toEqual({
      docPathParts: ['docs'],
      view: {key: 'activity'},
    })
  })

  it('extracts simple view terms', () => {
    expect(extractExportView(['docs', ':directory'])).toEqual({
      docPathParts: ['docs'],
      view: {key: 'directory'},
    })
    expect(extractExportView([':all-documents'])).toEqual({
      docPathParts: [],
      view: {key: 'all-documents'},
    })
  })
})
