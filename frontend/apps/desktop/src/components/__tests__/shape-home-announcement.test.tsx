// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const state = vi.hoisted(() => ({
  getStateData: null as null | {
    modal: {windowId: string; uid: string; candidateTitles: string[]} | null
    sites: Record<string, any>
    needsShaping: string[]
  },
  windowId: 'win-1' as string,
  modalReadyCalls: 0,
  modalLearnMoreCalls: 0,
  modalNotNowCalls: 0,
  modalShapeHomeCalls: 0,
}))

vi.mock('@/trpc', () => ({
  client: {
    shapeHome: {
      getState: {
        query: () => Promise.resolve(state.getStateData),
      },
      modalReady: {mutate: () => Promise.resolve((state.modalReadyCalls++, null))},
      modalLearnMore: {mutate: () => Promise.resolve((state.modalLearnMoreCalls++, null))},
      modalNotNow: {mutate: () => Promise.resolve((state.modalNotNowCalls++, null))},
      modalShapeHome: {mutate: () => Promise.resolve((state.modalShapeHomeCalls++, null))},
    },
  },
}))

vi.mock('@shm/ui/shape-home-announcement', () => ({
  ShapeHomeAnnouncement: ({candidateTitles, onLearnMore, onNotNow, onShapeHome}: any) => (
    <div data-testid="announcement">
      <div data-testid="titles">{candidateTitles.join(',')}</div>
      <button onClick={onLearnMore}>Learn more</button>
      <button onClick={onNotNow}>Not now</button>
      <button onClick={onShapeHome}>Shape my Home</button>
    </div>
  ),
}))

vi.mock('@shm/ui/components/dialog', () => ({
  Dialog: ({children, open}: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({children, onEscapeKeyDown, onInteractOutside}: any) => (
    <div
      data-testid="dialog-content"
      data-escape-blocked={!!onEscapeKeyDown}
      data-outside-blocked={!!onInteractOutside}
    >
      {children}
    </div>
  ),
}))

import {ShapeHomeAnnouncementDialog} from '../shape-home-announcement'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const qc = new QueryClient({defaultOptions: {queries: {staleTime: Infinity, retry: false}}})
  act(() => {
    root!.render(
      <QueryClientProvider client={qc}>
        <ShapeHomeAnnouncementDialog />
      </QueryClientProvider>,
    )
  })
}

function rerender() {
  act(() => {
    root!.render(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {staleTime: Infinity, retry: false}}})}>
        <ShapeHomeAnnouncementDialog />
      </QueryClientProvider>,
    )
  })
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  state.getStateData = null
  state.windowId = 'win-1'
  state.modalReadyCalls = 0
  state.modalLearnMoreCalls = 0
  state.modalNotNowCalls = 0
  state.modalShapeHomeCalls = 0
  ;(window as any).windowId = 'win-1'
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('ShapeHomeAnnouncementDialog', () => {
  it('renders nothing when modal is null', async () => {
    state.getStateData = {modal: null, sites: {}, needsShaping: []}
    render()
    await act(async () => {
      await flushPromises()
    })
    expect(document.body.querySelector('[data-testid="dialog"]')).toBeNull()
  })

  it('renders nothing when modal windowId is a different window', async () => {
    state.getStateData = {
      modal: {windowId: 'other-win', uid: 'alice', candidateTitles: ['About']},
      sites: {},
      needsShaping: ['alice'],
    }
    ;(window as any).windowId = 'win-1'
    render()
    await act(async () => {
      await flushPromises()
    })
    expect(document.body.querySelector('[data-testid="dialog"]')).toBeNull()
  })

  it('renders the 3 titles and sends modalReady once when this window owns the modal', async () => {
    state.getStateData = {
      modal: {windowId: 'win-1', uid: 'alice', candidateTitles: ['About', 'Projects', 'Blog']},
      sites: {},
      needsShaping: ['alice'],
    }
    render()
    await act(async () => {
      await flushPromises()
    })
    await act(async () => {
      await flushPromises()
    })
    expect(document.body.querySelector('[data-testid="dialog"]')).not.toBeNull()
    expect(document.body.querySelector('[data-testid="titles"]')?.textContent).toBe('About,Projects,Blog')
    expect(state.modalReadyCalls).toBe(1)
  })

  it('does not resend modalReady on re-render', async () => {
    state.getStateData = {
      modal: {windowId: 'win-1', uid: 'alice', candidateTitles: ['About']},
      sites: {},
      needsShaping: ['alice'],
    }
    render()
    await act(async () => {
      await flushPromises()
    })
    rerender()
    await act(async () => {
      await flushPromises()
    })
    expect(state.modalReadyCalls).toBe(1)
  })

  it('Escape does not close (handler installed)', async () => {
    state.getStateData = {
      modal: {windowId: 'win-1', uid: 'alice', candidateTitles: ['About']},
      sites: {},
      needsShaping: ['alice'],
    }
    render()
    await act(async () => {
      await flushPromises()
    })
    const content = document.body.querySelector('[data-testid="dialog-content"]')
    expect(content?.getAttribute('data-escape-blocked')).toBe('true')
    expect(content?.getAttribute('data-outside-blocked')).toBe('true')
  })

  it('Learn more and Not now call the right mutations', async () => {
    state.getStateData = {
      modal: {windowId: 'win-1', uid: 'alice', candidateTitles: ['About']},
      sites: {},
      needsShaping: ['alice'],
    }
    render()
    await act(async () => {
      await flushPromises()
    })
    const learnMore = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Learn more')!
    act(() => learnMore.click())
    expect(state.modalLearnMoreCalls).toBe(1)

    const notNow = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Not now')!
    act(() => notNow.click())
    expect(state.modalNotNowCalls).toBe(1)
  })

  it('Shape my Home calls the shapeHome mutation', async () => {
    state.getStateData = {
      modal: {windowId: 'win-1', uid: 'alice', candidateTitles: ['About']},
      sites: {},
      needsShaping: ['alice'],
    }
    render()
    await act(async () => {
      await flushPromises()
    })
    const shapeHome = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent === 'Shape my Home',
    )!
    act(() => shapeHome.click())
    expect(state.modalShapeHomeCalls).toBe(1)
  })
})
