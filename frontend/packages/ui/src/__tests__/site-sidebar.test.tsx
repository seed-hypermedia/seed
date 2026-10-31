// @vitest-environment jsdom
import {useState} from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SiteSidebar} from '../site-sidebar'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const viewer = vi.hoisted(() => ({uid: 'own', desktop: false}))
vi.mock('@shm/shared/constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get IS_DESKTOP() {
    return viewer.desktop
  },
}))
vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: () => ({data: undefined}),
  useSelectedAccountId: () => viewer.uid || null,
  useAccounts: (uids: string[]) => uids.map((uid) => ({data: {metadata: {name: uid}}})),
}))
vi.mock('@shm/shared/models/contacts', () => ({
  useSelectedAccountContacts: () => ({
    data: [
      {subject: 'joined', subscribe: {site: true}},
      {subject: 'joined', subscribe: {site: true}},
      {subject: 'person', subscribe: {profile: true}},
    ],
  }),
}))
vi.mock('../hm-icon', () => ({HMIcon: () => null}))
vi.mock('../site-file-browser', () => ({SiteFileBrowser: () => null}))

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  viewer.uid = 'own'
  viewer.desktop = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  HTMLElement.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Page({isGateway = true}: {isGateway?: boolean}) {
  const [site, setSite] = useState('current')
  return (
    <UniversalAppProvider isGateway={isGateway} openRoute={() => {}} openUrl={() => {}} universalClient={{} as any}>
      <SiteSidebar siteId={hmId(site)} ownSiteUids={['own', 'other-own']} onNavigate={(id) => setSite(id.uid)}>
        <main>{site} home</main>
      </SiteSidebar>
    </UniversalAppProvider>
  )
}
function openSelector() {
  act(() => root.render(<Page />))
  act(() =>
    container
      .querySelector('[aria-label="Select site"]')!
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})),
  )
}

describe('site selector', () => {
  it.each(['own', ''])('hides site switching on personal domains for viewer %s', (uid) => {
    viewer.uid = uid
    act(() => root.render(<Page isGateway={false} />))
    expect(container.querySelector('[aria-label="Select site"]')).toBeNull()
    expect(container.querySelector('main')?.textContent).toBe('current home')
    expect(container.textContent).toContain('Explore')
  })

  it('keeps site switching available in desktop even without a web gateway', () => {
    viewer.desktop = true
    act(() => root.render(<Page isGateway={false} />))
    expect(container.querySelector('[aria-label="Select site"]')).not.toBeNull()
  })

  it('includes current, own and joined sites once and navigates to the selected home', () => {
    openSelector()
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(options.map((option) => option.textContent)).toEqual(['current', 'own', 'other-own', 'joined'])
    act(() => options.find((option) => option.textContent === 'joined')!.click())
    expect(container.querySelector('main')?.textContent).toBe('joined home')
    expect(container.querySelector('[aria-label="Select site"]')?.textContent).toBe('joined')
  })

  it('shows only the current site when signed out, even with cached contacts', () => {
    viewer.uid = ''
    openSelector()
    expect(Array.from(document.querySelectorAll('[role="menuitem"]')).map((option) => option.textContent)).toEqual([
      'current',
    ])
  })
})
