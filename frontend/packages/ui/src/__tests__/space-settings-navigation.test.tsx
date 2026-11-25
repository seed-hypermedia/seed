// @vitest-environment jsdom
import type {HMDocument, HMMetadata, HMNavigationItem} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The publish call, which each platform supplies, and the search that needs a backend.
const mutateAsync = vi.hoisted(() => vi.fn())
const navigate = vi.hoisted(() => vi.fn())
vi.mock('../hm-doc-url-input', () => ({HMDocURLInput: () => null}))
vi.mock('@shm/shared/utils/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/utils/navigation')>()),
  useNavigate: () => navigate,
}))

import {
  getNavigationPreviewItems,
  HeaderAddLink,
  MAX_NAV_LINKS,
  SpaceSettingsNavigation,
} from '../space-settings-navigation'
import {EditNavPanePlacementContext} from '../site-header'
import {TooltipProvider} from '../tooltip'

function navLink(id: string): HMNavigationItem {
  return {id, type: 'Link', text: `Link ${id}`, link: `hm://space/${id}`}
}

function homeWithLinks(items: HMNavigationItem[]) {
  return {
    metadata: {name: 'Space'},
    detachedBlocks: {
      navigation: {
        block: {id: 'navigation', type: 'Group'} as any,
        children: items.map((item) => ({block: {id: item.id, type: 'Link', text: item.text, link: item.link} as any})),
      },
    },
  } as unknown as HMDocument
}

/** The metadata a save would publish, given what is published at that moment. */
function savedMetadata(published: HMMetadata = {name: 'Space'}) {
  return mutateAsync.mock.calls[0]![0].updateMetadata(published)
}

let root: Root
let container: HTMLDivElement

function renderTab(home: HMDocument) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <TooltipProvider>
        <SpaceSettingsNavigation
          siteId={hmId('space')}
          document={home}
          updateHome={{mutateAsync, isPending: false}}
          onDirtyChange={() => {}}
        />
      </TooltipProvider>,
    )
  })
}

function button(label: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label,
  )!
}

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  mutateAsync.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('getNavigationPreviewItems', () => {
  it('prepends Home without modifying persisted navigation items', () => {
    const configured: HMNavigationItem[] = [{id: 'about', type: 'Link', text: 'About', link: 'hm://about'}]

    const preview = getNavigationPreviewItems(configured)

    expect(preview.map((item) => item.text)).toEqual(['Home', 'About'])
    expect(configured.map((item) => item.text)).toEqual(['About'])
  })
})

describe('SpaceSettingsNavigation', () => {
  it('lets a link be added below the limit', () => {
    renderTab(homeWithLinks([navLink('a')]))
    expect(button('Add a link').disabled).toBe(false)
  })

  it('stops adding links once the top bar is full', () => {
    renderTab(homeWithLinks(Array.from({length: MAX_NAV_LINKS}, (_, i) => navLink(String(i)))))
    expect(button('Add a link').disabled).toBe(true)
  })

  it('removes a link with its x and saves the bar without it', async () => {
    renderTab(homeWithLinks([navLink('a'), navLink('b')]))

    act(() => button('Remove Link a').click())
    await act(async () => button('Save').click())

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    const {navigation} = mutateAsync.mock.calls[0]![0]
    const metadata = savedMetadata()
    expect(navigation.map((item: HMNavigationItem) => item.id)).toEqual(['b'])
    // Untouched display settings stay unwritten, so they do not start
    // overriding every document in the space.
    expect(metadata).not.toHaveProperty('contentWidth')
    expect(metadata).not.toHaveProperty('showOutline')
  })

  it('saves the outline setting for the whole space when it changes', async () => {
    renderTab(homeWithLinks([]))

    const outline = container.querySelector<HTMLButtonElement>('#space-show-outline')!
    act(() => outline.click())
    await act(async () => button('Save').click())

    expect(savedMetadata()).toMatchObject({showOutline: false})
  })

  it('moves a link onto the row a finger drags it to', async () => {
    renderTab(homeWithLinks([navLink('a'), navLink('b'), navLink('c')]))
    const rowC = container.querySelector('[data-nav-item-id="c"]')!
    document.elementFromPoint = () => rowC
    const handle = container.querySelector('[data-nav-item-id="a"] .cursor-grab') as HTMLElement
    handle.setPointerCapture = vi.fn()
    function pointer(type: string, clientX = 0, clientY = 0) {
      const event = new MouseEvent(type, {bubbles: true, clientX, clientY})
      Object.defineProperties(event, {pointerType: {value: 'touch'}, pointerId: {value: 1}})
      act(() => {
        handle.dispatchEvent(event)
      })
    }
    const floatingCopy = () => container.querySelector<HTMLElement>('[data-nav-item-id="a"][aria-hidden="true"]')

    pointer('pointerdown', 10, 20)
    expect(floatingCopy()?.textContent).toContain('Link a')
    pointer('pointermove', 15, 60)
    expect(floatingCopy()?.style.transform).toBe('translate(5px, 40px)')
    expect(rowC.className).toContain('ring-2')
    pointer('pointerup', 15, 60)
    expect(floatingCopy()).toBeNull()
    await act(async () => button('Save').click())

    expect(mutateAsync.mock.calls[0]![0].navigation.map((item: HMNavigationItem) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('keeps dragging with the first finger when a second one touches another row', async () => {
    renderTab(homeWithLinks([navLink('a'), navLink('b'), navLink('c')]))
    const rowC = container.querySelector('[data-nav-item-id="c"]')!
    document.elementFromPoint = () => rowC
    const firstHandle = container.querySelector('[data-nav-item-id="a"] .cursor-grab') as HTMLElement
    const secondHandle = container.querySelector('[data-nav-item-id="b"] .cursor-grab') as HTMLElement
    firstHandle.setPointerCapture = vi.fn()
    secondHandle.setPointerCapture = vi.fn()
    function pointer(handle: HTMLElement, type: string, pointerId: number) {
      const event = new MouseEvent(type, {bubbles: true})
      Object.defineProperties(event, {pointerType: {value: 'touch'}, pointerId: {value: pointerId}})
      act(() => {
        handle.dispatchEvent(event)
      })
    }
    const floatingCopies = () => container.querySelectorAll('[aria-hidden="true"][data-nav-item-id]')

    pointer(firstHandle, 'pointerdown', 1)
    pointer(secondHandle, 'pointerdown', 2)
    expect(floatingCopies()).toHaveLength(1)

    pointer(secondHandle, 'pointerup', 2)
    expect(floatingCopies()).toHaveLength(1)

    pointer(firstHandle, 'pointerup', 1)
    expect(floatingCopies()).toHaveLength(0)
    await act(async () => button('Save').click())

    expect(mutateAsync.mock.calls[0]![0].navigation.map((item: HMNavigationItem) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('drops the floating row and keeps the order when the system cancels a finger drag', () => {
    renderTab(homeWithLinks([navLink('a'), navLink('b')]))
    const handle = container.querySelector('[data-nav-item-id="a"] .cursor-grab') as HTMLElement
    handle.setPointerCapture = vi.fn()
    function pointer(type: string) {
      const event = new MouseEvent(type, {bubbles: true})
      Object.defineProperties(event, {pointerType: {value: 'touch'}, pointerId: {value: 1}})
      act(() => {
        handle.dispatchEvent(event)
      })
    }

    pointer('pointerdown')
    pointer('pointercancel')

    expect(container.querySelector('[aria-hidden="true"][data-nav-item-id]')).toBeNull()
    expect(button('Save').disabled).toBe(true)
  })

  it('previews the logo in place of the icon and name, as the header shows it', () => {
    renderTab({...homeWithLinks([]), metadata: {name: 'Space', seedExperimentalLogo: 'ipfs://logo'}} as HMDocument)

    expect(container.querySelector('img[alt="Space"]')?.getAttribute('src')).toContain('logo')
    expect(container.textContent).not.toContain('Space')
  })

  it('previews the name when the space has no logo', () => {
    renderTab(homeWithLinks([]))

    expect(container.querySelector('img[alt="Space"]')).toBeNull()
    expect(container.textContent).toContain('Space')
  })

  it('keeps metadata published since the tab opened', async () => {
    renderTab(homeWithLinks([]))

    const outline = container.querySelector<HTMLButtonElement>('#space-show-outline')!
    act(() => outline.click())
    await act(async () => button('Save').click())

    expect(savedMetadata({siteUrl: 'https://concurrent.example', theme: {headerLayout: 'Center'}})).toMatchObject({
      siteUrl: 'https://concurrent.example',
      showOutline: false,
    })
  })

  it('reports unsaved edits, and none once it closes', () => {
    const onDirtyChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <TooltipProvider>
          <SpaceSettingsNavigation
            siteId={hmId('space')}
            document={homeWithLinks([navLink('a')])}
            updateHome={{mutateAsync, isPending: false}}
            onDirtyChange={onDirtyChange}
          />
        </TooltipProvider>,
      )
    })
    act(() => button('Remove Link a').click())
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    act(() => root.unmount())
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    root = createRoot(container)
  })
})

describe('Add link dialog', () => {
  // The dialog renders in a portal, outside the tab's container.
  function dialogButton(label: string) {
    return Array.from(document.body.querySelectorAll('button')).find((el) => el.textContent?.trim() === label)!
  }
  function type(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  }
  function addExternalLink(url: string, name: string) {
    act(() => button('Add a link').click())
    act(() => document.querySelector<HTMLButtonElement>('button[role="radio"][value="external"]')!.click())
    act(() => type(document.querySelector<HTMLInputElement>('input[aria-label="URL"]')!, url))
    act(() => type(document.querySelector<HTMLInputElement>('#nav-link-name')!, name))
  }

  it('opens without focusing a field, so a phone keyboard stays closed', () => {
    renderTab(homeWithLinks([]))

    act(() => button('Add a link').click())

    expect(document.activeElement?.tagName).not.toBe('INPUT')
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull()
  })

  it('adds an external link, completing a bare domain to a web address', async () => {
    renderTab(homeWithLinks([]))

    addExternalLink('behance.net/alberti', 'Portfolio')
    act(() => dialogButton('Add link').click())
    await act(async () => button('Save').click())

    expect(mutateAsync.mock.calls[0]![0].navigation).toEqual([
      expect.objectContaining({text: 'Portfolio', link: 'https://behance.net/alberti'}),
    ])
  })

  it('explains an invalid URL once the owner leaves the field', () => {
    renderTab(homeWithLinks([]))

    addExternalLink('not a url', 'Portfolio')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="URL"]')!
    expect(document.body.textContent).not.toContain('Enter a valid web address')

    act(() => {
      input.focus()
      input.blur()
    })

    expect(document.body.textContent).toContain('Enter a valid web address')
  })

  it('enables Save link only once the edited link differs', () => {
    renderTab(homeWithLinks([navLink('a')]))

    act(() => button('Edit Link a').click())
    expect(dialogButton('Save link').disabled).toBe(true)

    act(() => type(document.querySelector<HTMLInputElement>('#nav-link-name')!, 'About'))
    expect(dialogButton('Save link').disabled).toBe(false)
  })

  it('keeps Add link disabled until the URL is a web address', () => {
    renderTab(homeWithLinks([]))

    addExternalLink('not a url', 'Portfolio')

    expect(dialogButton('Add link').disabled).toBe(true)
  })
})

describe('Header add-link button', () => {
  function renderHeaderButton(home: HMDocument, placement: 'header' | 'menu' = 'header') {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(
        <TooltipProvider>
          <EditNavPanePlacementContext.Provider value={placement}>
            <HeaderAddLink siteId={hmId('space')} document={home} updateHome={{mutateAsync, isPending: false}} />
          </EditNavPanePlacementContext.Provider>
        </TooltipProvider>,
      )
    })
    act(() => button('Add or edit links').click())
  }
  // The dialog renders in a portal, outside the button's container.
  function dialogButton(label: string) {
    return Array.from(document.body.querySelectorAll('button')).find((el) => el.textContent?.trim() === label)!
  }
  function type(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  }

  beforeEach(() => navigate.mockReset())

  it('publishes a new link straight away, after the existing ones', async () => {
    renderHeaderButton(homeWithLinks([navLink('a')]))

    act(() => document.querySelector<HTMLButtonElement>('button[role="radio"][value="external"]')!.click())
    act(() => type(document.querySelector<HTMLInputElement>('input[aria-label="URL"]')!, 'example.com'))
    act(() => type(document.querySelector<HTMLInputElement>('#nav-link-name')!, 'Example'))
    await act(async () => dialogButton('Add link').click())

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(mutateAsync.mock.calls[0]![0].navigation).toEqual([
      navLink('a'),
      expect.objectContaining({text: 'Example', link: 'https://example.com'}),
    ])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('offers only the way to make room once the top bar is full', () => {
    renderHeaderButton(homeWithLinks(Array.from({length: MAX_NAV_LINKS}, (_, i) => navLink(String(i)))))

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('The top bar is full')
    expect(document.body.textContent).toContain(`The top bar can hold up to ${MAX_NAV_LINKS} links`)
    expect(document.querySelector('[role="dialog"] input, [role="dialog"] [role="radio"]')).toBeNull()
    expect(dialogButton('Add link')).toBeUndefined()
    expect(dialogButton('Manage links')).toBeDefined()
  })

  it('appears as a list item in the phone menu and opens the same dialog', () => {
    renderHeaderButton(homeWithLinks([navLink('a')]), 'menu')

    expect(button('Add or edit links').className).toContain('w-full')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Add link to the top bar')
  })

  it('sends the owner to the Navigation settings to edit links', () => {
    renderHeaderButton(homeWithLinks([navLink('a')]))

    act(() => dialogButton('Manage links').click())

    expect(navigate).toHaveBeenCalledWith({key: 'site-settings', id: hmId('space'), tab: 'navigation'})
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
