// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  encodeMermaidClickTargets,
  Markdown,
  MarkdownAssetContext,
  resolveTranscriptLinkTarget,
} from '../agents/markdown'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const renderDiagram = vi.fn()
const openUrl = vi.fn()
const clickNavigate = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: unknown[]) => renderDiagram(...args),
  },
}))
vi.mock('@shm/shared/models/entity', () => ({useResource: () => ({data: null})}))
vi.mock('../agents/models', () => ({
  useAgentMemoryFile: () => ({data: null}),
  useSessionAttachmentDataUrls: () => ({}),
}))
vi.mock('../agents/platform', () => ({getAgentsPlatform: () => ({})}))
vi.mock('../agents/navigation', () => ({
  useOpenUrl: () => openUrl,
  useClickNavigate: () => clickNavigate,
  resolveHypermediaRoute: () => null,
}))

const DIAGRAM = '```mermaid\ngraph TD\n  A --> B\n```'

describe('Markdown mermaid fences', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    renderDiagram.mockReset()
    openUrl.mockReset()
    clickNavigate.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function render(markdown: string) {
    act(() => {
      root.render(<Markdown>{markdown}</Markdown>)
    })
  }

  /** Runs the debounce timer and flushes the async mermaid render. */
  async function settle() {
    await act(async () => {
      await vi.runAllTimersAsync()
    })
  }

  it('replaces a mermaid fence with the rendered SVG', async () => {
    renderDiagram.mockResolvedValue({svg: '<svg data-diagram="yes"></svg>'})
    render(DIAGRAM)
    // Before the debounce fires, the source shows as a plain code block.
    expect(container.querySelector('pre')?.textContent).toContain('graph TD')
    await settle()
    expect(renderDiagram).toHaveBeenCalledWith(expect.any(String), 'graph TD\n  A --> B\n')
    expect(container.querySelector('svg[data-diagram="yes"]')).toBeTruthy()
    expect(container.querySelector('pre')).toBeNull()
    // The clickable-node hover styles install once into the document head.
    expect(container.querySelector('.hm-mermaid')).toBeTruthy()
    expect(document.getElementById('hm-mermaid-diagram-style')?.textContent).toContain('.hm-mermaid a:hover')
  })

  it('keeps showing the source as code while the diagram fails to parse', async () => {
    renderDiagram.mockRejectedValue(new Error('parse error'))
    render('```mermaid\ngraph TD\n  A -->\n```')
    await settle()
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('graph TD')
  })

  it('leaves other code fences untouched', async () => {
    render('```js\nconst x = 1\n```')
    await settle()
    expect(renderDiagram).not.toHaveBeenCalled()
    expect(container.querySelector('pre code')?.textContent).toContain('const x = 1')
  })

  function renderWithScope(markdown: string) {
    act(() => {
      root.render(
        <MarkdownAssetContext.Provider value={{serverUrl: 'https://srv.example', agentId: 'agent-1', sessionId: 's1'}}>
          <Markdown>{markdown}</Markdown>
        </MarkdownAssetContext.Provider>,
      )
    })
  }

  function clickAnchor(href: string) {
    const anchor = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href') === href)
    expect(anchor, `anchor ${href}`).toBeTruthy()
    act(() => {
      anchor!.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
  }

  it('routes diagram anchors: hm:// and https open via the platform, ~/memory lands on the Memory tab', async () => {
    renderDiagram.mockResolvedValue({
      svg: '<svg><a href="https://mermaid-link.invalid/?to=hm%3A%2F%2Fz6MkAbc%2Fnotes"><g>doc</g></a><a href="https://example.com"><g>web</g></a><a href="~/memory/plan.md"><g>mem</g></a><a href="javascript:alert(1)"><g>evil</g></a></svg>',
    })
    renderWithScope('```mermaid\ngraph TD\n  A --> B\n  click A "hm://z6MkAbc/notes"\n```')
    await settle()
    // The click target reaches mermaid pre-encoded so DOMPurify keeps the anchor.
    expect(renderDiagram).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('click A "https://mermaid-link.invalid/?to=hm%3A%2F%2Fz6MkAbc%2Fnotes"'),
    )

    clickAnchor('https://mermaid-link.invalid/?to=hm%3A%2F%2Fz6MkAbc%2Fnotes')
    expect(openUrl).toHaveBeenLastCalledWith('hm://z6MkAbc/notes', false)
    clickAnchor('https://example.com')
    expect(openUrl).toHaveBeenLastCalledWith('https://example.com', false)
    clickAnchor('~/memory/plan.md')
    expect(clickNavigate).toHaveBeenCalledWith(
      {key: 'agent', agentId: 'agent-1', serverUrl: 'https://srv.example', tab: 'memory', memoryPath: 'plan.md'},
      expect.anything(),
    )
    openUrl.mockClear()
    clickNavigate.mockClear()
    clickAnchor('javascript:alert(1)')
    expect(openUrl).not.toHaveBeenCalled()
    expect(clickNavigate).not.toHaveBeenCalled()
  })

  it('intercepts app-routable markdown links but leaves plain web links to the browser', async () => {
    renderWithScope('[doc](hm://z6MkAbc/notes) and [ipfs](ipfs://bafyabc) and [web](https://example.com/x)')
    await settle()

    clickAnchor('hm://z6MkAbc/notes')
    expect(openUrl).toHaveBeenLastCalledWith('hm://z6MkAbc/notes', false)

    // The ipfs anchor's href is rewritten to a gateway URL for hover/copy, but the click
    // routes the original ipfs:// URL to the platform opener (which inspects it locally).
    const ipfsAnchor = [...container.querySelectorAll('a')].find((a) => a.textContent === 'ipfs')
    expect(ipfsAnchor?.getAttribute('target')).toBeNull()
    act(() => {
      ipfsAnchor!.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(openUrl).toHaveBeenLastCalledWith('ipfs://bafyabc', false)

    openUrl.mockClear()
    const webAnchor = [...container.querySelectorAll('a')].find((a) => a.textContent === 'web')
    expect(webAnchor?.getAttribute('target')).toBe('_blank')
    act(() => {
      webAnchor!.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('opens plain markdown ~/memory links in the Memory view', async () => {
    renderWithScope('See [the plan](~/memory/plans/q3.md).')
    await settle()
    clickAnchor('~/memory/plans/q3.md')
    expect(clickNavigate).toHaveBeenCalledWith(
      {key: 'agent', agentId: 'agent-1', serverUrl: 'https://srv.example', tab: 'memory', memoryPath: 'plans/q3.md'},
      expect.anything(),
    )
  })
})

describe('encodeMermaidClickTargets', () => {
  it('proxies hm:// and ipfs:// click targets, leaving other lines and labels alone', () => {
    const encoded = encodeMermaidClickTargets(
      'graph TD\n  A["see hm://z6Mk/inline"] --> B\n  click A "hm://z6Mk/doc" "tip"\n  click B "https://x.test"\n',
    )
    expect(encoded).toContain('click A "https://mermaid-link.invalid/?to=hm%3A%2F%2Fz6Mk%2Fdoc" "tip"')
    expect(encoded).toContain('A["see hm://z6Mk/inline"]')
    expect(encoded).toContain('click B "https://x.test"')
  })

  it('round-trips through resolveTranscriptLinkTarget, decoded or not', () => {
    expect(resolveTranscriptLinkTarget('https://mermaid-link.invalid/?to=hm%3A%2F%2Fz6Mk%2Fdoc', 'https://gw')).toEqual(
      {kind: 'open', url: 'hm://z6Mk/doc'},
    )
    expect(resolveTranscriptLinkTarget('https://mermaid-link.invalid/?to=hm://z6Mk/doc', 'https://gw')).toEqual({
      kind: 'open',
      url: 'hm://z6Mk/doc',
    })
  })
})

describe('resolveTranscriptLinkTarget', () => {
  const GATEWAY = 'https://gw.example'
  it('classifies memory, ipfs, hm, and web links; blocks the rest', () => {
    expect(resolveTranscriptLinkTarget('~/memory/a/b.md', GATEWAY)).toEqual({kind: 'memory', path: 'a/b.md'})
    expect(resolveTranscriptLinkTarget('/workspace/a/b.md', GATEWAY)).toEqual({kind: 'memory', path: 'a/b.md'})
    // ipfs:// passes through raw — the platform opener routes it to the local IPFS inspector.
    expect(resolveTranscriptLinkTarget('ipfs://bafyabc', GATEWAY)).toEqual({kind: 'open', url: 'ipfs://bafyabc'})
    expect(resolveTranscriptLinkTarget('hm://z6Mk/doc', GATEWAY)).toEqual({kind: 'open', url: 'hm://z6Mk/doc'})
    expect(resolveTranscriptLinkTarget('https://x.test', GATEWAY)).toEqual({kind: 'open', url: 'https://x.test'})
    expect(resolveTranscriptLinkTarget('javascript:alert(1)', GATEWAY)).toBeNull()
    expect(resolveTranscriptLinkTarget('attachment:abc', GATEWAY)).toBeNull()
  })
})
