import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {SidebarContextProvider, useSidebarContext} from '../sidebar-context'
import ExploreDesktopPage from '../pages/explore'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/utils/useNavigate', () => ({useNavigate: () => () => {}}))
vi.mock('@shm/shared/utils/navigation', () => ({
  useNavRoute: () => ({key: 'explore', context: {type: 'node'}}),
  useNavigationState: () => ({sidebarLocked: true}),
  useNavigationDispatch: () => () => {},
}))
vi.mock('@shm/shared/models/explore', () => ({useExploreResults: () => ({results: []})}))
vi.mock('@shm/ui/explore-page', () => ({ExplorePage: () => null}))
vi.mock('@shm/ui/document-top-bar', () => ({DocumentTopBar: () => null}))

let root: Root
let container: HTMLDivElement
let sidebar: ReturnType<typeof useSidebarContext>

function Probe() {
  sidebar = useSidebarContext()
  return null
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('closes an open sidebar on Explore entry and allows the user to reopen it', () => {
  act(() =>
    root.render(
      <SidebarContextProvider>
        <Probe />
        <ExploreDesktopPage />
      </SidebarContextProvider>,
    ),
  )
  expect(sidebar.isLocked.get()).toBe(false)
  act(() => sidebar.onLockSidebarOpen())
  expect(sidebar.isLocked.get()).toBe(true)
  act(() =>
    root.render(
      <SidebarContextProvider>
        <Probe />
        <ExploreDesktopPage />
      </SidebarContextProvider>,
    ),
  )
  expect(sidebar.isLocked.get()).toBe(true)
})
