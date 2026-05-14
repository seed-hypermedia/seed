import React, {useState} from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMNavigationItem} from '@seed-hypermedia/client/hm-types'
import {afterEach, describe, expect, it, vi} from 'vitest'

const {packHmIdMock, resolveHypermediaUrlMock, useDirectoryMock, useSearchMock} = vi.hoisted(() => ({
  packHmIdMock: vi.fn((id: {uid: string; path?: string[]}) => `hm://${id.uid}/${id.path?.join('/') || ''}`),
  resolveHypermediaUrlMock: vi.fn(),
  useDirectoryMock: vi.fn(() => ({data: []})),
  useSearchMock: vi.fn(() => ({data: {entities: []}})),
}))

vi.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({
  combine:
    (...cleanupFns: Array<() => void>) =>
    () =>
      cleanupFns.forEach((fn) => fn()),
}))

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: () => () => {},
  dropTargetForElements: () => () => {},
  monitorForElements: () => () => {},
}))

vi.mock('@shm/shared', () => ({
  packHmId: packHmIdMock,
  unpackHmId: vi.fn((value: string) => {
    if (!value.startsWith('hm://')) return null
    const [, rest] = value.split('hm://')
    const segments = rest.split('/')
    return {
      path: segments.slice(1),
    }
  }),
  useSearch: useSearchMock,
}))

vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: useDirectoryMock,
  useResource: vi.fn(() => ({data: null})),
}))

vi.mock('@seed-hypermedia/client', () => ({
  resolveHypermediaUrl: resolveHypermediaUrlMock,
}))

vi.mock('@shm/ui/button', () => ({
  Button: ({children, ...props}: any) => <button {...props}>{children}</button>,
}))

vi.mock('@shm/ui/components/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

vi.mock('@shm/ui/components/popover', () => ({
  Popover: ({children}: any) => <>{children}</>,
  PopoverTrigger: ({children, asChild: _asChild, ...props}: any) => <div {...props}>{children}</div>,
  PopoverContent: ({children}: any) => <div>{children}</div>,
}))

vi.mock('@shm/ui/forms', () => ({
  FormField: ({label, children}: any) => (
    <label>
      <span>{label}</span>
      {children}
    </label>
  ),
}))

vi.mock('@shm/ui/search', () => ({
  SearchResultItem: ({item}: any) => (
    <button type="button" data-search-result={item.title} onClick={() => item.onSelect?.()}>
      {item.title}
    </button>
  ),
}))

vi.mock('@shm/ui/spinner', () => ({
  Spinner: () => <div>Spinner</div>,
}))

vi.mock('@shm/ui/use-popover-state', () => ({
  usePopoverState: vi.fn(() => ({open: false, onOpenChange: vi.fn()})),
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span />,
  EllipsisVertical: () => <span />,
  Globe: () => <span />,
  Pencil: () => <span />,
  Plus: () => <span />,
  Search: () => <span />,
  Trash: () => <span />,
}))

import {EditNavPopover} from '../edit-navigation-popover'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function TestHarness({initialDocNav}: {initialDocNav: HMNavigationItem[]}) {
  const [docNav, setDocNav] = useState(initialDocNav)
  return <EditNavPopover docNav={docNav} editDocNav={setDocNav} />
}

function renderPopover(docNav: HMNavigationItem[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<TestHarness initialDocNav={docNav} />)
  })

  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    input.value = value
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

afterEach(() => {
  useSearchMock.mockReset()
  useSearchMock.mockReturnValue({data: {entities: []}})
  useDirectoryMock.mockReset()
  useDirectoryMock.mockReturnValue({data: []})
  resolveHypermediaUrlMock.mockReset()
})

describe('EditNavPopover trigger', () => {
  it('shows the empty-state CTA when navigation has no items', () => {
    const {container, root} = renderPopover([])

    try {
      expect(container.textContent).toContain('Add Navigation Item')
      expect(container.textContent?.match(/Add Navigation Item/g)).toHaveLength(1)
    } finally {
      cleanup(root, container)
    }
  })

  it('keeps the compact icon-only trigger once navigation items exist', () => {
    const {container, root} = renderPopover([{id: 'nav-1', type: 'Link', text: 'Docs', link: 'hm://alice/docs'}])

    try {
      const trigger = container.querySelector('.no-window-drag')
      expect(trigger?.textContent).not.toContain('Add Navigation Item')
    } finally {
      cleanup(root, container)
    }
  })

  it('shows editable link and label inputs for a new item', () => {
    const {container, root} = renderPopover([{id: 'nav-1', type: 'Link', text: '', link: ''}])

    try {
      expect(container.textContent).toContain('Navigation')
      expect(container.textContent).toContain('Untitled item')
      expect(container.textContent).toContain('Incomplete')
      expect(container.textContent).toContain('Link')
      expect(container.textContent).toContain('Label')
      expect(container.querySelector('input[placeholder="Search documents or paste URL"]')).not.toBeNull()
      expect(container.textContent!.indexOf('Link')).toBeLessThan(container.textContent!.indexOf('Label'))
    } finally {
      cleanup(root, container)
    }
  })
})
