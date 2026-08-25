import React from 'react'
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
import {isSpaceDocumentsActiveRoute} from '../sidebar-active'

describe('isSpaceDocumentsActiveRoute', () => {
  const spaceId = hmId('space')

  it('marks child documents for the space active', () => {
    expect(isSpaceDocumentsActiveRoute({key: 'document', id: hmId('space', {path: ['docs', 'intro']})}, spaceId)).toBe(
      true,
    )
  })

  it('marks document views for the space active', () => {
    expect(isSpaceDocumentsActiveRoute({key: 'all-documents', id: spaceId}, spaceId)).toBe(true)
    expect(isSpaceDocumentsActiveRoute({key: 'comments', id: hmId('space', {path: ['docs']})}, spaceId)).toBe(true)
    expect(isSpaceDocumentsActiveRoute({key: 'activity', id: hmId('space', {path: ['docs']})}, spaceId)).toBe(true)
    expect(isSpaceDocumentsActiveRoute({key: 'directory', id: hmId('space', {path: ['docs']})}, spaceId)).toBe(true)
    expect(isSpaceDocumentsActiveRoute({key: 'collaborators', id: hmId('space', {path: ['docs']})}, spaceId)).toBe(true)
    expect(isSpaceDocumentsActiveRoute({key: 'feed', id: hmId('space', {path: ['docs']})}, spaceId)).toBe(true)
  })

  it('does not mark unrelated spaces or non-document routes active', () => {
    expect(isSpaceDocumentsActiveRoute({key: 'document', id: hmId('other', {path: ['docs']})}, spaceId)).toBe(false)
    expect(isSpaceDocumentsActiveRoute({key: 'profile', id: spaceId}, spaceId)).toBe(false)
    expect(isSpaceDocumentsActiveRoute({key: 'library'}, spaceId)).toBe(false)
  })
})
