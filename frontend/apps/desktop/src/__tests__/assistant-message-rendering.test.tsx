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
  openUrl: vi.fn(),
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => mockState.navigate,
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

import {ChatMessageBubble} from '../components/assistant-message-rendering'

/** Renders one assistant bubble carrying the given tool part. */
function renderToolPart(part: ChatMessagePart) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<ChatMessageBubble message={{role: 'assistant', content: '', parts: [part]}} />)
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

  it('renders a user-facing read tool bubble', () => {
    const {container, root} = renderToolPart({
      type: 'tool',
      id: 'tool-1',
      name: 'read',
      args: {id: 'hm://z6Mkabc/projects/seed'},
      result: 'Read "Seed Notes".',
      rawOutput: {
        summary: 'Read "Seed Notes".',
        resourceUrl: 'hm://z6Mkabc/projects/seed',
        view: 'document',
        title: 'Seed Notes',
        displayLabel: 'Seed Notes in Seed',
        markdown: '# Seed Notes\n\nProject status and notes.',
      },
    })

    expect(container.textContent).toContain('Read document: Seed Notes')
    expect(container.textContent).not.toContain('hm://z6Mkabc/projects/seed')
    expect(container.textContent).not.toContain('Project status and notes.')

    click(findButton(container, (element) => element.textContent === 'Seed Notes'))
    expect(mockState.openUrl).toHaveBeenCalledWith('hm://z6Mkabc/projects/seed', false)

    click(findButton(container, (element) => element.getAttribute('title') === 'Show tool details'))
    expect(container.textContent).toContain('Project status and notes.')

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
