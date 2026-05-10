import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {describe, expect, it, vi} from 'vitest'
import type {HMNavigationItem} from '@seed-hypermedia/client/hm-types'

vi.mock('@shm/shared', () => ({
  packHmId: vi.fn(),
  unpackHmId: vi.fn(),
  useSearch: vi.fn(() => ({data: {entities: []}})),
}))

vi.mock('@shm/shared/models/entity', () => ({
  useDirectory: vi.fn(() => ({data: []})),
  useResource: vi.fn(() => ({data: null})),
}))

vi.mock('@seed-hypermedia/client', () => ({
  resolveHypermediaUrl: vi.fn(),
}))

vi.mock('@shm/ui/button', () => ({
  Button: ({children, ...props}: any) => <button {...props}>{children}</button>,
}))

vi.mock('@shm/ui/components/popover', () => ({
  Popover: ({children}: any) => <>{children}</>,
  PopoverTrigger: ({children, ...props}: any) => <div {...props}>{children}</div>,
  PopoverContent: () => null,
}))

vi.mock('@shm/ui/use-popover-state', () => ({
  usePopoverState: vi.fn(() => ({open: false, onOpenChange: vi.fn()})),
}))

vi.mock('lucide-react', () => ({
  EllipsisVertical: () => <span />,
  Globe: () => <span />,
  Pencil: () => <span />,
  Plus: () => <span />,
  Search: () => <span />,
  Trash: () => <span />,
}))

import {EditNavPopover} from '../edit-navigation-popover'

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function renderPopover(docNav: HMNavigationItem[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(<EditNavPopover docNav={docNav} editDocNav={vi.fn()} />)
  })

  return {container, root}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('EditNavPopover trigger', () => {
  it('shows the empty-state CTA when navigation has no items', () => {
    const {container, root} = renderPopover([])

    try {
      expect(container.textContent).toContain('Add Navigation Item')
    } finally {
      cleanup(root, container)
    }
  })

  it('keeps the compact icon-only trigger once navigation items exist', () => {
    const {container, root} = renderPopover([{id: 'nav-1', type: 'Link', text: 'Docs', link: 'hm://alice/docs'}])

    try {
      expect(container.textContent).not.toContain('Add Navigation Item')
    } finally {
      cleanup(root, container)
    }
  })
})
