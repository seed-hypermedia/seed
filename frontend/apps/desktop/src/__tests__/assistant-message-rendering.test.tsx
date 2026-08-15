import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {ChatMessagePart} from '@/models/chat-parts'

/**
 * Rendering coverage for assistant/agent chat bubbles.
 *
 * These assertions previously ran through the desktop assistant panel, which owned its own chat
 * runtime. The panel is now a thin view over an agent session, so they target the shared renderer
 * directly — the component actually under test — and stay independent of how a transcript is loaded.
 */

const mockState = vi.hoisted(() => ({
  navigate: vi.fn(),
  clickNavigate: vi.fn(),
  openUrl: vi.fn(),
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => mockState.navigate,
  useClickNavigate: () => mockState.clickNavigate,
}))

vi.mock('@/open-url', () => ({
  useOpenUrl: () => mockState.openUrl,
}))

// Avoid vi.importActual here: navigation → routing → utils barrel → url-to-route → navigation
// forms a circular dependency that deadlocks vitest's module loader.
vi.mock('@shm/shared/utils/navigation', () => {
  const React = require('react')
  const NavContext = React.createContext(null)
  return {
    useNavRoute: () => ({key: 'library'}),
    useNavigation: () => ({state: {}, dispatch: vi.fn()}),
    NavContextProvider: NavContext.Provider,
    navStateReducer: (state: any) => state,
    getRouteKey: () => 'library',
    appRouteOfId: () => undefined,
    isHttpUrl: () => false,
    useNavigate: () => vi.fn(),
    useNavigationState: () => ({}),
    useNavigationDispatch: () => vi.fn(),
    useRouteDocId: () => null,
  }
})

vi.mock('@shm/shared/utils/entity-id-url', async () => {
  const actual = await vi.importActual<typeof import('@shm/shared/utils/entity-id-url')>(
    '@shm/shared/utils/entity-id-url',
  )
  return {...actual, packHmId: vi.fn()}
})

vi.mock('../components/markdown', () => ({
  Markdown: ({children}: {children: React.ReactNode}) => React.createElement('div', null, children),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: null}),
}))

// models/agents creates the tRPC client at import time, which needs the electronTRPC preload global.
vi.mock('@/models/agents', () => ({
  useSessionAttachmentDataUrls: () => ({}),
  // The delegate row resolves its live child through these; inert here — no child ever resolves.
  useSessionRuns: () => ({data: undefined}),
  useRunTree: () => ({data: undefined}),
  useRun: () => ({data: undefined, isLoading: false}),
  useAgentRunTreeSubscription: () => ({runs: {}, progress: {}, activity: {}, journal: []}),
  useCancelRun: () => ({mutate: () => {}, isPending: false}),
  useSignalRun: () => ({mutate: () => {}, isPending: false}),
}))

import {AgentErrorRow, ChatMessageBubble} from '../components/assistant-message-rendering'

/** Renders one assistant bubble carrying the given tool part. */
function renderToolPart(part: ChatMessagePart, serverUrl?: string, agentId?: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <ChatMessageBubble
        message={{role: 'assistant', content: '', parts: [part]}}
        serverUrl={serverUrl}
        agentId={agentId}
      />,
    )
  })
  return {container, root}
}

/** Renders a bubble for an errored assistant message. */
function renderErrorMessage(errorMessage: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ChatMessageBubble message={{role: 'assistant', content: '', errorMessage}} />)
  })
  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function findButton(container: HTMLElement, predicate: (element: HTMLButtonElement) => boolean) {
  return Array.from(container.querySelectorAll('button')).find(predicate)
}

function click(element: Element | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
  })
}

describe('assistant message rendering', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.navigate.mockReset()
    mockState.openUrl.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reveals the exact window context a user message carried behind an info chip', () => {
    // Context is model-facing and never renders as message text — but the user must be able to
    // audit exactly what the agent was told about what they were looking at.
    const contextLines = ['## Current window', 'URL: hm://z6MkDoc/plan', 'View: document']
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<ChatMessageBubble message={{role: 'user', content: 'What is this?', contextLines}} />)
    })

    // The bubble shows only the user's words plus the chip.
    expect(container.textContent).toContain('What is this?')
    expect(container.textContent).not.toContain('hm://z6MkDoc/plan')
    const chip = findButton(container, (element) => element.textContent?.includes('Context') ?? false)
    expect(chip).toBeTruthy()

    click(chip)
    expect(document.body.textContent).toContain('Context shared with the agent')
    expect(document.body.textContent).toContain('URL: hm://z6MkDoc/plan')
    expect(document.body.textContent).toContain('View: document')

    cleanupRendered(root, container)
  })

  it('shows no context chip on messages that carried none', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<ChatMessageBubble message={{role: 'user', content: 'Hello'}} />)
    })

    expect(findButton(container, (element) => element.textContent?.includes('Context') ?? false)).toBeUndefined()

    cleanupRendered(root, container)
  })

  it('renders provider errors with destructive styling in the transcript', () => {
    const {container, root} = renderErrorMessage('Quota exceeded for model gemini-3.1-pro.')
    const errorBlock = Array.from(container.querySelectorAll('.text-destructive')).find(
      (element) => element.textContent?.includes('Quota exceeded for model gemini-3.1-pro.'),
    )

    expect(errorBlock?.className).toContain('text-destructive')

    cleanupRendered(root, container)
  })

  it('renders one-line search tool calls with expandable registry details', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-1',
      name: 'search',
      args: {query: 'seed'},
      result: 'Found 1 result for "seed".',
      rawOutput: {
        summary: 'Found 1 result for "seed".',
        query: 'seed',
        searchType: 'hybrid',
        includeBody: false,
        markdown:
          'Search results for "seed" (1 result, search type: hybrid, include body: no)\n\n1. [Seed Notes](hm://z6Mkabc/projects/seed)\n   - Type: document\n   - Parents: Projects\n   - Updated: 3/19/2026, 10:00 AM\n   - URL: hm://z6Mkabc/projects/seed',
        results: [
          {
            title: 'Seed Notes',
            url: 'hm://z6Mkabc/projects/seed',
            type: 'document',
            parentNames: ['Projects'],
            versionTime: '3/19/2026, 10:00 AM',
          },
        ],
      },
    })

    expect(container.textContent).toContain('Search')
    expect(container.textContent).toContain('Found 1 result for "seed".')
    expect(container.textContent).toContain('Seed Notes')
    expect(container.textContent).not.toContain('Search results for "seed"')

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))

    expect(container.textContent).toContain('Search results for "seed"')
    expect(container.textContent).toContain('"query": "seed"')

    cleanupRendered(root, container)
  })

  it('names the hypermedia document a read returned, and opens it', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-1',
      name: 'read',
      args: {address: 'hm://z6Mkabc/projects/seed'},
      result: 'Read "Seed Notes".',
      rawOutput: {
        type: 'hypermedia_document',
        id: 'hm://z6Mkabc/projects/seed',
        title: 'Seed Notes',
        markdown: '# Seed Notes\n\nProject status and notes.',
      },
    })

    // The document's own name, plus which world it came from — never "Read document: document".
    expect(container.textContent).toContain('Read')
    expect(container.textContent).toContain('Seed Notes')
    expect(container.textContent).toContain('hm doc')
    expect(container.textContent).not.toContain('Project status and notes.')

    click(findButton(container, (element) => element.textContent === 'Seed Notes'))
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkabc/projects/seed', false)

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))
    expect(container.textContent).toContain('Project status and notes.')
    // The address itself is a way in, not a string to read.
    expect(findButton(container, (element) => element.textContent === 'hm://z6Mkabc/projects/seed')).toBeTruthy()

    cleanupRendered(root, container)
  })

  it('shows the memory file a read touched, and opens it in the agent Memory tab', () => {
    const {container, root} = renderToolPart(
      {
        type: 'tool',
        id: 'tool-memory-read',
        name: 'read',
        args: {address: '~/memory/notes/competitors.md'},
        result: 'Read notes/competitors.md (412 bytes).',
        rawOutput: {
          summary: 'Read notes/competitors.md (412 bytes).',
          path: 'notes/competitors.md',
          size: 412,
          content: 'Acme ships weekly.',
        },
      },
      'http://localhost:3050',
      'agent-1',
    )

    expect(container.textContent).toContain('Read')
    expect(container.textContent).toContain('notes/competitors.md')
    expect(container.textContent).toContain('memory')
    expect(container.textContent).not.toContain('Acme ships weekly.')

    click(findButton(container, (element) => element.textContent === 'notes/competitors.md'))
    expect(mockState.clickNavigate).toHaveBeenCalledWith(
      {
        key: 'agent',
        agentId: 'agent-1',
        serverUrl: 'http://localhost:3050',
        tab: 'memory',
        memoryPath: 'notes/competitors.md',
      },
      expect.anything(),
    )

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))
    expect(container.textContent).toContain('Acme ships weekly.')

    cleanupRendered(root, container)
  })

  it('lists a memory directory read with its entries as links', () => {
    const {container, root} = renderToolPart(
      {
        type: 'tool',
        id: 'tool-memory-list',
        name: 'read',
        args: {address: '~/memory/notes/'},
        rawOutput: {
          summary: 'notes/ holds 2 files (500 bytes).',
          path: 'notes',
          entries: [
            {path: 'notes/competitors.md', type: 'file', size: 412},
            {path: 'notes/archive', type: 'dir'},
          ],
        },
      },
      'http://localhost:3050',
      'agent-1',
    )

    expect(container.textContent).toContain('Listed')
    expect(container.textContent).toContain('2 entries')

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))
    click(findButton(container, (element) => element.textContent === 'notes/competitors.md'))
    expect(mockState.clickNavigate).toHaveBeenCalledWith(
      expect.objectContaining({tab: 'memory', memoryPath: 'notes/competitors.md'}),
      expect.anything(),
    )

    cleanupRendered(root, container)
  })

  it('names a web page read by its host and path', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-web-read',
      name: 'read',
      args: {address: 'https://bun.sh/blog/bun-v1.2'},
      rawOutput: {
        summary: 'Read Bun 1.2 via the static reader.',
        finalUrl: 'https://bun.sh/blog/bun-v1.2',
        title: 'Bun 1.2',
        markdown: 'Bun 1.2 is here.',
      },
    })

    expect(container.textContent).toContain('bun.sh/blog/bun-v1.2')
    expect(container.textContent).toContain('web')

    click(findButton(container, (element) => element.textContent === 'bun.sh/blog/bun-v1.2'))
    expect(mockState.openUrl).toHaveBeenCalledWith('https://bun.sh/blog/bun-v1.2', false)

    cleanupRendered(root, container)
  })

  it('says what a memory write saved, and where', () => {
    const {container, root} = renderToolPart(
      {
        type: 'tool',
        id: 'tool-memory-write',
        name: 'write',
        args: {address: '~/memory/dl.txt', options: {fromUrl: 'https://example.com/dl.txt'}},
        rawOutput: {
          summary: 'Downloaded https://example.com/dl.txt to dl.txt (12 bytes).',
          path: 'dl.txt',
          size: 12,
          finalUrl: 'https://example.com/dl.txt',
        },
      },
      'http://localhost:3050',
      'agent-1',
    )

    expect(container.textContent).toContain('Downloaded')
    expect(container.textContent).toContain('dl.txt')
    expect(container.textContent).toContain('from example.com/dl.txt')
    expect(container.textContent).toContain('memory')

    cleanupRendered(root, container)
  })

  it('renders a call row as the tool it called, not as "Call"', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-call-search',
      name: 'call',
      args: {tool: 'search', input: {query: 'seed'}},
      rawOutput: {
        summary: 'Found 1 result for "seed".',
        results: [{title: 'Seed Notes', url: 'hm://z6Mkabc/projects/seed'}],
      },
    })

    expect(container.textContent).toContain('Search')
    expect(container.textContent).not.toContain('Call')
    // The called tool's own links come along: its result is one click away.
    click(findButton(container, (element) => element.textContent?.includes('Seed Notes') ?? false))
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkabc/projects/seed', false)

    cleanupRendered(root, container)
  })

  it('renders the registry-defined comment.create write UI', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-comment',
      name: 'write',
      args: {command: 'comment.create', input: {target: 'hm://z6Mkdoc/spec', body: 'Great point!'}},
      result: 'comment.create completed',
      rawOutput: {
        command: 'comment.create',
        commentId: 'z6Mkdoc/spec/comment-1',
        targetUrl: 'hm://z6Mkdoc/spec',
        targetName: 'Spec Doc',
        signer: {profileName: 'Alice', publicKey: 'z6Mkauthor'},
        markdown: 'Great point!',
      },
    })

    expect(container.textContent).toContain('New Comment by Alice on Spec Doc')
    expect(container.textContent).not.toContain('Great point!')

    click(findButton(container, (element) => element.textContent === 'New Comment'))
    click(findButton(container, (element) => element.textContent === 'Alice'))
    click(findButton(container, (element) => element.textContent === 'Spec Doc'))

    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkdoc/spec/:comments/z6Mkdoc/spec/comment-1', false)
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkauthor/:profile', false)
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkdoc/spec', false)

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))
    expect(container.textContent).toContain('Great point!')

    click(findButton(container, (element) => element.getAttribute('title') === 'View raw tool input/output'))
    expect(document.body.textContent).toContain('Raw tool call payload captured during the assistant response.')
    expect(document.body.textContent).toContain('comment.create')

    cleanupRendered(root, container)
  })

  it('renders the registry-defined document.create write UI', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-document',
      name: 'write',
      args: {
        command: 'document.create',
        input: {path: '/product-brief', name: 'Product Brief', body: '# Product Brief\n\nShip it.'},
      },
      result: 'document.create completed',
      rawOutput: {
        command: 'document.create',
        id: 'hm://z6Mkdoc/product-brief',
        signer: {profileName: 'Alice', publicKey: 'z6Mkauthor'},
      },
    })

    expect(container.textContent).toContain('Create document: Product Brief')
    expect(container.textContent).not.toContain('Write')
    expect(container.textContent).not.toContain('document.create completed')

    click(findButton(container, (element) => element.textContent === 'Product Brief'))
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkdoc/product-brief', false)

    cleanupRendered(root, container)
  })

  it('renders the registry-defined document.update write UI with rendered content details', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-document-update',
      name: 'write',
      args: {
        command: 'document.update',
        input: {
          edit: 'hm://z6Mkdoc/product-brief',
          name: 'Product Brief',
          body: '# Product Brief\n\nUpdated plan.',
        },
      },
      result: 'document.update completed',
      rawOutput: {
        command: 'document.update',
        id: 'hm://z6Mkdoc/product-brief',
        version: 'bafyupdate',
      },
    })

    expect(container.textContent).toContain('Update document: Product Brief')
    expect(container.textContent).not.toContain('document.update completed')
    expect(container.textContent).not.toContain('Updated plan.')

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))

    expect(container.textContent).toContain('Updated plan.')
    expect(container.textContent).not.toContain('"input"')
    expect(container.textContent).not.toContain('"output"')

    cleanupRendered(root, container)
  })

  it('opens the sub-session from its title in the tool row', () => {
    const {container, root} = renderToolPart(
      {
        type: 'tool',
        id: 'tool-sub-session',
        name: 'delegate',
        args: {title: 'Research Acme', brief: 'go'},
        rawOutput: {status: 'succeeded', sessionId: 'child-session-1', runId: 'child-run-1'},
      },
      'http://localhost:3050',
    )

    const title = findButton(container, (element) => element.textContent === 'Research Acme')
    expect(title).toBeTruthy()
    click(title)
    expect(mockState.clickNavigate).toHaveBeenCalledWith(
      {key: 'agent-session', sessionId: 'child-session-1', serverUrl: 'http://localhost:3050'},
      expect.anything(),
    )
    // Opening the sub-session is not a request to expand the row.
    expect(findButton(container, (element) => element.getAttribute('title') === 'Show tool details')).toBeTruthy()

    cleanupRendered(root, container)
  })

  it('leaves the sub-session title as plain text until it has a session to open', () => {
    const {container, root} = renderToolPart(
      {
        type: 'tool',
        id: 'tool-sub-session-pending',
        name: 'delegate',
        args: {title: 'Research Acme', input: 'go'},
      },
      'http://localhost:3050',
    )

    expect(container.textContent).toContain('Research Acme')
    expect(findButton(container, (element) => element.textContent === 'Research Acme')).toBeUndefined()

    cleanupRendered(root, container)
  })

  it('falls back to a generic bubble for unrecognized tool calls', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-unknown',
      name: 'unknown_tool',
      args: {value: 'example'},
      result: 'Completed.',
    })

    expect(container.textContent).toContain('unknown_tool')
    expect(container.textContent).toContain('Completed.')
    expect(container.textContent).not.toContain('example')

    cleanupRendered(root, container)
  })
})

describe('agent error rows', () => {
  function renderErrorRow(props: React.ComponentProps<typeof AgentErrorRow>) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<AgentErrorRow {...props} />)
    })
    return {container, root}
  }

  it('shows the failure without a retry when the turn cannot be re-run', () => {
    const {container, root} = renderErrorRow({message: 'model call failed'})

    expect(container.textContent).toContain('model call failed')
    expect(findButton(container, (element) => element.textContent?.includes('Retry') ?? false)).toBeUndefined()

    cleanupRendered(root, container)
  })

  it('runs the retry handler when the turn can be re-run', () => {
    const onRetry = vi.fn()
    const {container, root} = renderErrorRow({message: 'model call failed', onRetry})

    const retry = findButton(container, (element) => element.textContent === 'Retry')
    expect(retry).toBeTruthy()
    expect(retry?.disabled).toBe(false)
    click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)

    cleanupRendered(root, container)
  })

  it('locks the button while the retry is in flight', () => {
    const onRetry = vi.fn()
    const {container, root} = renderErrorRow({message: 'model call failed', onRetry, retryPending: true})

    const retry = findButton(container, (element) => element.textContent?.includes('Retrying') ?? false)
    expect(retry?.disabled).toBe(true)
    click(retry)
    expect(onRetry).not.toHaveBeenCalled()
    expect(container.querySelector('.animate-spin')).toBeTruthy()

    cleanupRendered(root, container)
  })
})

it('marks user-run tool rows with a You chip', () => {
  const {container, root} = renderToolPart({
    type: 'tool',
    id: 'user-tool-1',
    name: 'read',
    actor: 'user',
    args: {address: '~/memory/notes.md'},
    result: 'Read notes.md (120 bytes).',
    rawOutput: {summary: 'Read notes.md (120 bytes).'},
  })
  expect(container.textContent).toContain('You')
  expect(container.textContent).toContain('Read')
  cleanupRendered(root, container)
})

/** Renders one bubble and hands back its container, matching the helpers above. */
function renderMessage(message: React.ComponentProps<typeof ChatMessageBubble>['message']) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ChatMessageBubble message={message} />)
  })
  return {container, root}
}

/**
 * The harness writes to the log too — continuation prompts, unmet-obligation notices, late
 * deliveries — and it writes them as user turns because that is the turn a model takes instruction
 * from. The transcript must not therefore claim the reader said them.
 */
describe('runtime-authored messages', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders a system-actor message as a quiet aside rather than the user bubble', () => {
    const {container, root} = renderMessage({
      role: 'user',
      actor: 'system',
      content: 'Two plan steps are still open. Finish them or say why not.',
    })

    expect(container.querySelector('[data-message-kind="system"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="system-message"]')).toBeTruthy()
    // Not the user's bubble: no sky fill, and it reads as subordinate muted text.
    expect(container.innerHTML).not.toContain('bg-sky-100')
    expect(container.querySelector('[data-testid="system-message"]')?.className).toContain('text-muted-foreground')
    expect(container.textContent).toContain('Two plan steps are still open.')

    cleanupRendered(root, container)
  })

  it('takes the same quiet path when the runtime speaks as the assistant', () => {
    const {container, root} = renderMessage({
      role: 'assistant',
      actor: 'system',
      content: 'The child delivered its result after this thread had moved on.',
    })

    expect(container.querySelector('[data-message-kind="system"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="system-message"]')).toBeTruthy()

    cleanupRendered(root, container)
  })

  it('still gives a message the user typed their own bubble', () => {
    const {container, root} = renderMessage({role: 'user', actor: 'user', content: 'Hello'})

    expect(container.querySelector('[data-message-kind="user"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="system-message"]')).toBeNull()
    expect(container.innerHTML).toContain('bg-sky-100')

    cleanupRendered(root, container)
  })

  it('leaves a trigger-actor message rendering as it always did', () => {
    const {container, root} = renderMessage({role: 'user', actor: 'trigger', content: 'Nightly review.'})

    expect(container.querySelector('[data-message-kind="user"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="system-message"]')).toBeNull()

    cleanupRendered(root, container)
  })
})

/**
 * What an event cost and where it came from, behind the ⓘ. The log is older than the stamp, so
 * every one of these dialogs has to work on events that carry nothing at all.
 */
describe('event info dialogs', () => {
  const STAMP = {
    model: 'gpt-5-mini',
    provider: 'openai',
    durationMs: 1420,
    usage: {input: 9102, output: 3381, cacheRead: 0, cacheWrite: 0, total: 12483},
  }

  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function openMessageDialog(container: HTMLElement) {
    click(findButton(container, (element) => element.getAttribute('aria-label') === 'Show markdown sent to the LLM'))
  }

  function openToolDialog(container: HTMLElement) {
    click(findButton(container, (element) => element.getAttribute('title') === 'View raw tool input/output'))
  }

  it('shows model, provider, timing and token usage for a stamped assistant message', () => {
    const {container, root} = renderMessage({role: 'assistant', content: 'Done.', meta: STAMP})

    openMessageDialog(container)
    expect(document.body.textContent).toContain('gpt-5-mini')
    expect(document.body.textContent).toContain('openai')
    expect(document.body.textContent).toContain('1.4s')
    expect(document.body.textContent).toContain('12,483 tokens')
    expect(document.body.textContent).toContain('9,102')
    expect(document.body.textContent).toContain('3,381')
    // A category that cost nothing is not a fact worth a row.
    expect(document.body.textContent).not.toContain('Cache read')

    cleanupRendered(root, container)
  })

  it('shows the same stats on a runtime-authored message', () => {
    const {container, root} = renderMessage({
      role: 'user',
      actor: 'system',
      content: 'Finishing the plan you left open.',
      meta: {model: 'gpt-5-mini', provider: 'openai', durationMs: 240},
    })

    openMessageDialog(container)
    expect(document.body.textContent).toContain('gpt-5-mini')
    expect(document.body.textContent).toContain('240ms')

    cleanupRendered(root, container)
  })

  it('still opens a working dialog on a legacy message with no stamp', () => {
    const {container, root} = renderMessage({role: 'assistant', content: 'From an older transcript.', seq: 4})

    openMessageDialog(container)
    expect(document.body.textContent).toContain('Message details')
    expect(document.body.textContent).toContain('From an older transcript.')
    // Nothing is known, so nothing is labelled: no empty stat rows.
    expect(document.body.textContent).not.toContain('Duration')
    expect(document.body.textContent).not.toContain('Provider')

    cleanupRendered(root, container)
  })

  it('shows a tool row its own timing and cost', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-meta-1',
      name: 'read',
      args: {address: '~/memory/notes.md'},
      result: 'Read notes.md.',
      rawOutput: {summary: 'Read notes.md.'},
      meta: {durationMs: 62_000, model: 'gpt-5-mini', provider: 'openai'},
    })

    openToolDialog(container)
    expect(document.body.textContent).toContain('1m 2s')
    expect(document.body.textContent).toContain('gpt-5-mini')
    expect(document.body.textContent).toContain('openai')

    cleanupRendered(root, container)
  })

  it('opens a legacy tool row dialog with its payloads and no stat block', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-meta-2',
      name: 'read',
      args: {address: '~/memory/notes.md'},
      result: 'Read notes.md.',
      rawOutput: {summary: 'Read notes.md.'},
    })

    openToolDialog(container)
    expect(document.body.textContent).toContain('Input')
    expect(document.body.textContent).toContain('Output')
    expect(document.body.textContent).not.toContain('Duration')

    cleanupRendered(root, container)
  })
})
