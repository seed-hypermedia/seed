// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Markdown, MarkdownAssetContext, resolveMarkdownImageSource} from '../agents/markdown'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const memoryFile = vi.fn()
vi.mock('../agents/models', () => ({
  useAgentMemoryFile: (...args: unknown[]) => memoryFile(...args),
  useSessionAttachmentDataUrls: () => ({}),
}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: null})}))
vi.mock('../agents/platform', () => ({getAgentsPlatform: () => ({useGatewayUrl: () => GATEWAY})}))
vi.mock('../agents/navigation', () => ({
  useOpenUrl: () => vi.fn(),
  resolveHypermediaRoute: () => null,
}))

const GATEWAY = 'https://gw.example'

describe('resolveMarkdownImageSource', () => {
  it('routes ipfs:// CIDs through the gateway, keeping any path suffix', () => {
    expect(resolveMarkdownImageSource('ipfs://bafyabc', `${GATEWAY}/`)).toEqual({
      kind: 'ipfs',
      cid: 'bafyabc',
      url: `${GATEWAY}/ipfs/bafyabc`,
    })
    expect(resolveMarkdownImageSource('ipfs://bafyabc/cover.png', GATEWAY)).toMatchObject({
      url: `${GATEWAY}/ipfs/bafyabc/cover.png`,
    })
  })

  it('reads memory paths as the agent writes them, including the sandbox mount', () => {
    expect(resolveMarkdownImageSource('~/memory/ads/one.png', GATEWAY)).toEqual({kind: 'memory', path: 'ads/one.png'})
    expect(resolveMarkdownImageSource('/workspace/ads/one.png', GATEWAY)).toEqual({kind: 'memory', path: 'ads/one.png'})
  })

  it('recognizes session attachments and leaves web URLs alone', () => {
    expect(resolveMarkdownImageSource('attachment:abc123', GATEWAY)).toEqual({kind: 'attachment', id: 'abc123'})
    expect(resolveMarkdownImageSource('https://x.test/a.png', GATEWAY)).toEqual({
      kind: 'url',
      url: 'https://x.test/a.png',
    })
  })
})

describe('Markdown images in a transcript', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    memoryFile.mockReset()
    // jsdom lacks object URLs; the memory image only needs a stable string.
    Object.assign(URL, {createObjectURL: () => 'blob:memory-image', revokeObjectURL: () => {}})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(markdown: string, scope?: React.ContextType<typeof MarkdownAssetContext>) {
    act(() => {
      root.render(
        scope ? (
          <MarkdownAssetContext.Provider value={scope}>
            <Markdown>{markdown}</Markdown>
          </MarkdownAssetContext.Provider>
        ) : (
          <Markdown>{markdown}</Markdown>
        ),
      )
    })
  }

  it('renders an ipfs:// image through the gateway instead of dropping the src', () => {
    render('![Square ad](ipfs://bafybeid4ik)')
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/\/ipfs\/bafybeid4ik$/)
    expect(img?.getAttribute('alt')).toBe('Square ad')
  })

  it('shows a memory image by fetching the bytes for the scoped agent', () => {
    memoryFile.mockReturnValue({
      isLoading: false,
      error: null,
      data: {path: 'ads/one.png', mimeType: 'image/png', encoding: 'binary', data: new Uint8Array([1, 2, 3])},
    })
    render('![The ad](~/memory/ads/one.png)', {
      serverUrl: 'https://agents.test',
      accountUid: 'acct',
      agentId: 'agent-1',
    })
    expect(memoryFile).toHaveBeenCalledWith('https://agents.test', 'acct', 'agent-1', 'ads/one.png')
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:memory-image')
  })

  it('falls back to a labeled placeholder for a memory image outside any agent scope', () => {
    render('![The ad](~/memory/ads/one.png)')
    expect(memoryFile).not.toHaveBeenCalled()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('The ad')
  })
})
