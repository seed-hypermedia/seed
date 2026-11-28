// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  gate: {} as any,
  navigate: vi.fn(),
}))

vi.mock('../use-web-shape-home-gate', () => ({useWebShapeHomeGate: () => mocks.gate}))
vi.mock('@remix-run/react', () => ({useNavigate: () => mocks.navigate}))
vi.mock('@shm/shared', () => ({
  useUniversalAppContext: () => ({originHomeId: {uid: 'z6Mksite', id: 'hm://z6Mksite', path: []}}),
  routeToHref: (route: any) => `/hm/${route.id.uid}`,
}))
vi.mock('@shm/ui/shape-home-announcement', () => ({
  LEARN_MORE_URL: 'hm://z6Mkdocs/build/sidebar-navigation',
  ShapeHomeAnnouncement: ({candidateTitles, onLearnMore, onNotNow, onShapeHome}: any) => (
    <div>
      <div data-testid="titles">{candidateTitles.join(',')}</div>
      <button onClick={onLearnMore}>Learn more</button>
      <button onClick={onNotNow}>Not now</button>
      <button onClick={onShapeHome}>Shape my Home</button>
    </div>
  ),
}))
vi.mock('@shm/ui/components/dialog', () => ({
  Dialog: ({children, open}: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({children}: any) => <div>{children}</div>,
}))

import {WebShapeHomeAnnouncement} from '../shape-home-announcement'
import {readShapeHomeState, writeShapeHomeState} from '../store'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const candidates = ['Agenda de Ocio', 'Con Historia', '¿Quiénes somos?', 'Zeta'].map((title, i) => ({
  id: {uid: 'z6Mksite', id: `hm://z6Mksite/p${i}`, path: [`p${i}`]},
  title,
}))

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(<WebShapeHomeAnnouncement />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!
  act(() => button.click())
}

beforeEach(() => {
  localStorage.clear()
  writeShapeHomeState({sites: {}})
  mocks.navigate.mockReset()
  mocks.gate = {uid: 'z6Mksite', eligible: true, modalDone: false, status: {eligible: true, candidates}}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('WebShapeHomeAnnouncement', () => {
  it('shows the modal in this tab with the first three candidate titles', async () => {
    await render()
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="titles"]')?.textContent).toBe(
      'Agenda de Ocio,Con Historia,¿Quiénes somos?',
    )
  })

  it('shows nothing when the gate is closed or the modal was already answered', async () => {
    mocks.gate = {...mocks.gate, eligible: false}
    await render()
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull()
    mocks.gate = {...mocks.gate, eligible: true, modalDone: true}
    await render()
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull()
  })

  it('Not now persists modalDone and dismisses only this site', async () => {
    writeShapeHomeState({sites: {z6Mkother: {status: 'shaped'}}})
    await render()
    click('Not now')
    expect(readShapeHomeState()).toEqual({
      modalDone: true,
      sites: {z6Mkother: {status: 'shaped'}, z6Mksite: {status: 'dismissed'}},
    })
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull()
  })

  it('Shape my Home persists modalDone, keeps the site open for the helper and navigates to Home', async () => {
    await render()
    click('Shape my Home')
    expect(readShapeHomeState()).toEqual({modalDone: true, sites: {}})
    expect(mocks.navigate).toHaveBeenCalledWith('/hm/z6Mksite')
  })

  it('Learn more opens a new tab and keeps the modal open', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await render()
    click('Learn more')
    expect(open).toHaveBeenCalledTimes(1)
    expect(String(open.mock.calls[0]![0])).toContain('z6Mkdocs')
    expect(open.mock.calls[0]![1]).toBe('_blank')
    expect(readShapeHomeState().modalDone).toBeUndefined()
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeNull()
    open.mockRestore()
  })
})
