import {describe, expect, it} from 'vitest'
import {prepareBrowserArchive} from '../app-browser-agent'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'

describe('browser archive', () => {
  it('preserves article structure, links, images and provenance in editable Seed content', async () => {
    const archive = await prepareBrowserArchive({
      url: 'https://example.com/article?edition=1',
      title: 'Original article',
      metadata: {
        author: 'Author',
        canonicalUrl: 'https://example.com/article',
        publishedAt: '2026-01-01',
        language: 'en',
        description: 'A summary',
      },
      html: '<h1>Heading</h1><p>A <strong>rich</strong> <a href="https://example.com/source">source</a>.</p><figure><img src="https://example.com/photo.jpg"><figcaption>Caption</figcaption></figure>',
    })
    expect(archive.metadata).toMatchObject({
      name: 'Original article',
      sourceAuthor: 'Author',
      sourceUrl: 'https://example.com/article?edition=1',
      sourceCanonicalUrl: 'https://example.com/article',
      sourcePublishedAt: '2026-01-01',
      sourceLanguage: 'en',
      summary: 'A summary',
    })
    expect(archive.metadata.sourceCapturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(archive.blocks)).toContain('"link":"https://example.com/photo.jpg"')
    expect(archive.markdown).toContain('sourceUrl:')
    expect(archive.markdown).toContain('Source: [https://example.com/article')
    expect(hmBlocksToEditorContent(archive.blocks).length).toBeGreaterThan(0)
  })
})
