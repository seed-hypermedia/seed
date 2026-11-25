// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Markdown, MarkdownAssetContext, resolveTranscriptLinkTarget} from '../agents/markdown'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const renderDiagram = vi.fn()
const openUrl = vi.fn()
const clickNavigate = vi.fn()
vi.mock('pele/lazy', () => ({
  renderAsync: (...args: unknown[]) => renderDiagram(...args),
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
    // jsdom has no canvas; Pele uses its built-in text measurement fallback.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
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
    vi.restoreAllMocks()
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
    expect(renderDiagram).toHaveBeenCalledWith(
      'graph TD\n  A --> B\n',
      expect.objectContaining({idPrefix: expect.any(String)}),
    )
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
      svg: '<svg><a href="hm://z6MkAbc/notes"><g>doc</g></a><a href="https://example.com"><g>web</g></a><a href="~/memory/plan.md"><g>mem</g></a><a href="javascript:alert(1)"><g>evil</g></a></svg>',
    })
    renderWithScope('```mermaid\ngraph TD\n  A --> B\n  click A "hm://z6MkAbc/notes"\n```')
    await settle()
    clickAnchor('hm://z6MkAbc/notes')
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

  it('keeps app links usable with the real Pele renderer', async () => {
    const pele = await vi.importActual<typeof import('pele/lazy')>('pele/lazy')
    renderDiagram.mockImplementation(pele.renderAsync)
    renderWithScope(
      '```mermaid\ngraph TD\n A[Document] --> B[Memory]\n click A "hm://z6MkAbc/notes"\n click B "~/memory/plan.md"\n```',
    )
    await settle()

    clickAnchor('hm://z6MkAbc/notes')
    expect(openUrl).toHaveBeenLastCalledWith('hm://z6MkAbc/notes', false)
    clickAnchor('~/memory/plan.md')
    expect(clickNavigate).toHaveBeenCalledWith(
      {key: 'agent', agentId: 'agent-1', serverUrl: 'https://srv.example', tab: 'memory', memoryPath: 'plan.md'},
      expect.anything(),
    )
  })

  it('recovers from incomplete source with the real Pele renderer', async () => {
    const pele = await vi.importActual<typeof import('pele/lazy')>('pele/lazy')
    renderDiagram.mockImplementation(pele.renderAsync)
    render('```mermaid\ngraph TD\n A -->\n```')
    await settle()
    expect(container.querySelector('pre')?.textContent).toContain('A -->')

    render(DIAGRAM)
    await settle()
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('ignores a render that finishes after its source has changed', async () => {
    let finishFirst!: (value: {svg: string}) => void
    renderDiagram.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve
      }),
    )
    render(DIAGRAM)
    await settle()
    renderDiagram.mockResolvedValue({svg: '<svg><text>Current</text></svg>'})
    render('```mermaid\ngraph TD\n C --> D\n```')
    await settle()
    await act(async () => {
      finishFirst({svg: '<svg><text>Old</text></svg>'})
    })
    expect(container.textContent).toBe('Current')
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
