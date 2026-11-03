import type {HMDocument, HMNavigationItem} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import {TooltipProvider} from '@shm/ui/tooltip'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

// The daemon-backed hooks: the published home document, ownership, and the publish call.
const mutateAsync = vi.hoisted(() => vi.fn())
vi.mock('@/components/edit-navigation-popover', () => ({HMDocURLInput: () => null}))
vi.mock('@/models/site', () => ({useUpdateHomeDocument: () => ({mutateAsync, isPending: false})}))
vi.mock('@shm/shared/models/capabilities', () => ({useIsSiteOwner: vi.fn()}))
vi.mock('@shm/shared/models/entity', () => ({useResource: vi.fn()}))

import {getNavigationPreviewItems, MAX_NAV_LINKS, NavigationSettings} from '../site-settings-navigation'

function navLink(id: string): HMNavigationItem {
  return {id, type: 'Link', text: `Link ${id}`, link: `hm://space/${id}`}
}

function homeWithLinks(items: HMNavigationItem[]): Partial<HMDocument> {
  return {
    metadata: {name: 'Space'},
    detachedBlocks: {
      navigation: {
        block: {id: 'navigation', type: 'Group'} as any,
        children: items.map((item) => ({block: {id: item.id, type: 'Link', text: item.text, link: item.link} as any})),
      },
    },
  }
}

let root: Root
let container: HTMLDivElement

function renderTab(home: Partial<HMDocument>) {
  vi.mocked(useResource).mockReturnValue({data: {type: 'document', document: home}} as any)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <TooltipProvider>
        <NavigationSettings siteId={hmId('space')} />
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
  vi.mocked(useIsSiteOwner).mockReturnValue({isSiteOwner: true, isLoading: false})
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

describe('NavigationSettings', () => {
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
    const {navigation, metadata} = mutateAsync.mock.calls[0][0]
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

    expect(mutateAsync.mock.calls[0][0].metadata).toMatchObject({showOutline: false})
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

  it('adds an external link, completing a bare domain to a web address', async () => {
    renderTab(homeWithLinks([]))

    addExternalLink('behance.net/alberti', 'Portfolio')
    act(() => dialogButton('Add link').click())
    await act(async () => button('Save').click())

    expect(mutateAsync.mock.calls[0][0].navigation).toEqual([
      expect.objectContaining({text: 'Portfolio', link: 'https://behance.net/alberti'}),
    ])
  })

  it('selects the whole URL with Cmd+A', () => {
    renderTab(homeWithLinks([]))

    addExternalLink('https://behance.net/alberti', 'Portfolio')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="URL"]')!
    input.setSelectionRange(0, 0)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', metaKey: true, bubbles: true}))
    })

    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length])
  })

  it('explains an invalid URL once the owner leaves the field', () => {
    renderTab(homeWithLinks([]))

    addExternalLink('not a url', 'Portfolio')
    const input = document.querySelector<HTMLInputElement>('input[aria-label="URL"]')!
    expect(document.body.textContent).not.toContain('Enter a web address')

    act(() => {
      input.focus()
      input.blur()
    })

    expect(document.body.textContent).toContain('Enter a web address')
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
