import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@shm/ui/components/dropdown-menu', () => ({
  DropdownMenu: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
  DropdownMenuContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
  DropdownMenuItem: ({children, onClick, variant: _variant, ...props}: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({children, onClick, ...props}: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@shm/ui/components/sidebar', () => ({
  SidebarMenuAction: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
import {isSiteDocumentsActiveRoute} from '../sidebar-active'
import {BookmarkOptionsMenu} from '../bookmark-options-menu'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('isSiteDocumentsActiveRoute', () => {
  const siteId = hmId('site')

  it('marks child documents for the site active', () => {
    expect(isSiteDocumentsActiveRoute({key: 'document', id: hmId('site', {path: ['docs', 'intro']})}, siteId)).toBe(
      true,
    )
  })

  it('marks document views for the site active', () => {
    expect(isSiteDocumentsActiveRoute({key: 'all-documents', id: siteId}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'comments', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'activity', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'directory', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'collaborators', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
    expect(isSiteDocumentsActiveRoute({key: 'feed', id: hmId('site', {path: ['docs']})}, siteId)).toBe(true)
  })

  it('does not mark unrelated sites or non-document routes active', () => {
    expect(isSiteDocumentsActiveRoute({key: 'document', id: hmId('other', {path: ['docs']})}, siteId)).toBe(false)
    expect(isSiteDocumentsActiveRoute({key: 'profile', id: siteId}, siteId)).toBe(false)
    expect(isSiteDocumentsActiveRoute({key: 'library'}, siteId)).toBe(false)
  })
})

function renderBookmarkOptionsMenu(onDeleteBookmark = vi.fn(), parentClick = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <div onClick={parentClick}>
        <BookmarkOptionsMenu onDeleteBookmark={onDeleteBookmark} disabled={false} />
      </div>,
    )
  })

  return {container, root, onDeleteBookmark, parentClick}
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

describe('BookmarkOptionsMenu', () => {
  it('shows a delete action that removes the bookmark without navigating', () => {
    const onDeleteBookmark = vi.fn()
    const parentClick = vi.fn()
    const {container, root} = renderBookmarkOptionsMenu(onDeleteBookmark, parentClick)

    try {
      expect(container.textContent).toContain('Delete Bookmark')
      const deleteButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Delete Bookmark'),
      )
      expect(deleteButton).toBeTruthy()

      act(() => {
        deleteButton?.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
          }),
        )
      })

      expect(onDeleteBookmark).toHaveBeenCalledTimes(1)
      expect(parentClick).not.toHaveBeenCalled()
    } finally {
      cleanup(root, container)
    }
  })
})
