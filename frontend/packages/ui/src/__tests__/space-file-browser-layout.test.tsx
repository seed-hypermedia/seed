// @vitest-environment jsdom
import {hmId} from '@shm/shared'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {renderToString} from 'react-dom/server'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {SpaceFileBrowserLayout} from '../space-file-browser-layout'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const mediaMock = vi.hoisted(() => ({value: {xs: false}}))
const fileBrowserPropsMock = vi.hoisted(() => ({
  value: null as null | {onPrefetch?: (id: ReturnType<typeof hmId>) => void},
}))
vi.mock('../use-media', () => ({useMedia: () => mediaMock.value}))
vi.mock('../space-file-browser', () => ({
  SpaceFileBrowser: (props: {onPrefetch?: (id: ReturnType<typeof hmId>) => void}) => {
    fileBrowserPropsMock.value = props
    return <div data-testid="space-file-browser" />
  },
}))
vi.mock('../components/scroll-area', () => ({
  ScrollArea: ({children}: {children: React.ReactNode}) => <div data-testid="main-scroll-area">{children}</div>,
}))
vi.mock('../tooltip', () => ({
  Tooltip: ({content, children}: {content: string; children: React.ReactNode}) => (
    <div data-tooltip-content={content}>{children}</div>
  ),
}))
vi.mock('lucide-react', async () => {
  const makeIcon = (testId: string) => (props: React.SVGProps<SVGSVGElement>) => <svg data-testid={testId} {...props} />
  return {
    FolderTree: makeIcon('folder-tree-icon'),
    PanelLeft: makeIcon('panel-left-icon'),
    X: makeIcon('x-icon'),
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mediaMock.value = {xs: false}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  ;(globalThis as typeof globalThis & {ResizeObserver: typeof ResizeObserver}).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function renderLayout() {
  act(() => {
    root.render(
      <SpaceFileBrowserLayout
        spaceId={hmId('space')}
        activeDocumentId={hmId('space')}
        spaceName="Space"
        mobileOpen={false}
        onMobileOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      >
        <div data-testid="document-body">Document body</div>
      </SpaceFileBrowserLayout>,
    )
  })
}

describe('SpaceFileBrowserLayout', () => {
  it('passes document prefetch intent to the file browser', () => {
    const onPrefetch = vi.fn()
    act(() => {
      root.render(
        <SpaceFileBrowserLayout
          spaceId={hmId('space')}
          activeDocumentId={hmId('space')}
          spaceName="Space"
          mobileOpen={false}
          onMobileOpenChange={vi.fn()}
          onNavigate={vi.fn()}
          onPrefetch={onPrefetch}
        >
          <div>Document body</div>
        </SpaceFileBrowserLayout>,
      )
    })

    expect(fileBrowserPropsMock.value?.onPrefetch).toBe(onPrefetch)
  })

  it('server-renders a static 288px file explorer before client sizing is known', () => {
    const html = renderToString(
      <SpaceFileBrowserLayout
        spaceId={hmId('space')}
        activeDocumentId={hmId('space')}
        spaceName="Space"
        mobileOpen={false}
        onMobileOpenChange={vi.fn()}
        onNavigate={vi.fn()}
      >
        <div>Document body</div>
      </SpaceFileBrowserLayout>,
    )

    expect(html).toContain('Document body')
    expect(html).toContain('Documents')
    expect(html).toContain('w-72')
    expect(html).not.toContain('data-panel-group')
    expect(html).not.toContain('animate-spin')
  })

  it('fully collapses the explorer and overlays its reopen control on the main content', () => {
    renderLayout()

    expect(container.querySelector('[data-tooltip-content="Hide file explorer"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="panel-left-icon"]')).toBeTruthy()

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Collapse file browser"]')?.click()
    })

    expect(container.querySelector('[data-panel-id="space-file-browser"]')).toBeNull()
    expect(container.querySelector('[data-panel-resize-handle-id]')).toBeNull()
    const reopenControl = container.querySelector('[data-tooltip-content="Show file explorer"]')
    expect(reopenControl?.parentElement?.className).toContain('absolute')
    expect(reopenControl?.parentElement?.className).toContain('top-2')
    expect(reopenControl?.parentElement?.className).toContain('left-2')
    expect(container.querySelector('[data-testid="folder-tree-icon"]')).toBeTruthy()

    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Open file browser"]')?.click()
    })

    expect(container.querySelector('[data-panel-id="space-file-browser"]')).toBeTruthy()
    expect(container.querySelector('[data-tooltip-content="Show file explorer"]')).toBeNull()
  })

  it('keeps desktop main content in a constrained flex column for document scrolling', () => {
    renderLayout()

    expect(container.querySelector('[data-testid="main-scroll-area"]')).toBeNull()
    expect(container.textContent).toContain('Document body')
    expect(container.querySelector('[data-testid="document-body"]')?.parentElement?.className).toContain('flex-col')
  })

  it('keeps the mobile drawer pinned to 80 percent of the viewport', () => {
    mediaMock.value = {xs: true}

    act(() => {
      root.render(
        <SpaceFileBrowserLayout
          spaceId={hmId('space')}
          activeDocumentId={hmId('space')}
          spaceName="Space"
          mobileOpen={true}
          onMobileOpenChange={vi.fn()}
          onNavigate={vi.fn()}
        >
          <div>Document body</div>
        </SpaceFileBrowserLayout>,
      )
    })

    const drawer = document.body.querySelector('aside')
    expect(drawer?.className).toContain('w-[80dvw]')
    expect(drawer?.className).toContain('max-w-[80dvw]')
    expect(drawer?.className).toContain('shrink-0')
    expect(drawer?.className).toContain('motion-safe:slide-in-from-left')
  })
})
