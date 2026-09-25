// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest'
import type {WebContents} from 'electron'
import {localizeBrowserArchiveImages} from '../browser-archive-images'

import {prepareBrowserArchive} from '../app-browser-agent'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'

afterEach(() => vi.unstubAllGlobals())

describe('browser archive', () => {
  it('drops failed remote images into text links without an image request from the draft', async () => {
    const archive = await prepareBrowserArchive({
      url: 'https://example.com',
      title: 'Article',
      metadata: {},
      html: '<p>Article</p><img src="https://tracker.example/image">',
    })
    expect(archive.blocks.some((node) => node.block.type === 'Image')).toBe(false)
    expect(archive.markdown).toContain('[Image from source](https://tracker.example/image)')
    expect(archive.markdown).not.toContain('![')
  })
  it.each([
    new Headers({'content-type': 'application/octet-stream'}),
    new Headers({'content-type': 'image/png', 'content-length': String(5 * 1024 * 1024 + 1)}),
  ])('drops invalid images without uploading: %s', async (headers) => {
    const guest = {
      session: {fetch: vi.fn().mockResolvedValue(new Response('bad', {headers}))},
      getURL: () => 'https://example.com',
    } as unknown as WebContents
    const upload = vi.fn()
    vi.stubGlobal('fetch', upload)
    const archive = await prepareBrowserArchive(
      {url: 'https://example.com', title: 'Article', metadata: {}, html: '<img src="https://example.com/image">'},
      (blocks) => localizeBrowserArchiveImages(guest, blocks),
    )
    expect(archive.blocks.some((node) => node.block.type === 'Image')).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })

  it('preserves article structure, links, images and provenance in editable Seed content', async () => {
    const guest = {
      session: {fetch: vi.fn().mockResolvedValue(new Response('image', {headers: {'content-type': 'image/png'}}))},
      getURL: () => 'https://example.com/article',
    } as unknown as WebContents
    const upload = vi.fn().mockResolvedValue(new Response('bafyLocalImage'))
    vi.stubGlobal('fetch', upload)
    const archive = await prepareBrowserArchive(
      {
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
      },
      (blocks) => localizeBrowserArchiveImages(guest, blocks),
    )
    expect(upload).toHaveBeenCalledOnce()
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
    expect(JSON.stringify(archive.blocks)).toContain('"link":"ipfs://bafyLocalImage"')
    expect(archive.markdown).toContain('sourceUrl:')
    expect(archive.markdown).toContain('Source: [https://example.com/article')
    expect(hmBlocksToEditorContent(archive.blocks).length).toBeGreaterThan(0)
  })
})
