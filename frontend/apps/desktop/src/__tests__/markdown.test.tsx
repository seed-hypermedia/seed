import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const openUrlMock = vi.hoisted(() => vi.fn())
const useGatewayUrlMock = vi.hoisted(() => vi.fn())
const useResourceMock = vi.hoisted(() => vi.fn())

vi.mock('@/open-url', async () => {
  const actual = await vi.importActual<typeof import('@/open-url')>('@/open-url')
  return {
    ...actual,
    useOpenUrl: () => openUrlMock,
  }
})

vi.mock('@/models/gateway-settings', () => ({
  useGatewayUrl: () => useGatewayUrlMock(),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: (id: unknown) => useResourceMock(id),
}))

import {Markdown} from '../components/markdown'

function renderMarkdown(content: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<Markdown>{content}</Markdown>)
  })

  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('Markdown', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    openUrlMock.mockReset()
    useGatewayUrlMock.mockReset()
    useGatewayUrlMock.mockReturnValue({data: 'https://gw.seed.test'})
    useResourceMock.mockReset()
    useResourceMock.mockImplementation((id?: {uid?: string} | null) => {
      if (id?.uid === 'z6MkSite') {
        return {
          data: {
            type: 'document',
            document: {
              metadata: {
                siteUrl: 'https://site.seed.test',
              },
            },
          },
        }
      }
      return {data: null}
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders site-backed hm links as https hrefs and keeps raw hm navigation on click', () => {
    const rawHref = 'hm://z6MkSite/notes/:comments/z6MkAuthor/tsid123?panel=activity#blk1+'
    const {container, root} = renderMarkdown(`[Discussion](${rawHref})`)
    const link = container.querySelector('a')

    expect(link?.textContent).toBe('Discussion')
    expect(link?.getAttribute('href')).toBe(
      'https://site.seed.test/notes/:comments/z6MkAuthor/tsid123?panel=activity#blk1+',
    )

    act(() => {
      link?.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openUrlMock).toHaveBeenCalledWith(rawHref, false)

    cleanupRendered(root, container)
  })

  it('falls back to the configured gateway and preserves filtered activity urls', () => {
    const {container, root} = renderMarkdown('[Activity](hm://z6MkOther/notes/:activity/citations)')
    const link = container.querySelector('a')

    expect(link?.getAttribute('href')).toBe('https://gw.seed.test/hm/z6MkOther/notes/:activity/citations')

    cleanupRendered(root, container)
  })

  it('keeps external links as normal external anchors', () => {
    const {container, root} = renderMarkdown('[Website](https://example.com)')
    const link = container.querySelector('a')

    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')

    cleanupRendered(root, container)
  })
})
