// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
const state = vi.hoisted(() => ({identity: null as any}))
vi.mock('@/auth', () => ({useLocalKeyPair: () => state.identity}))
vi.mock('@shm/ui/universal-dialog', () => ({useAppDialog: vi.fn()}))
vi.mock('@shm/ui/components/dropdown-menu', () => ({
  DropdownMenuItem: ({onSelect, children}: any) => (
    <button role="menuitem" onClick={onSelect}>
      {children}
    </button>
  ),
}))
import {WebSpaceSettingsMenuItem} from './web-space-settings-menu'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
describe.each([false, true])('Space Settings account menu (mobile=%s)', (mobile) => {
  it('opens settings for the effective delegated owner rather than the session key', () => {
    state.identity = {id: 'device-key', delegatedAccountUid: 'owner'}
    const open = vi.fn()
    act(() => root.render(<WebSpaceSettingsMenuItem siteUid="owner" mobile={mobile} onSelect={open} />))
    expect(container.textContent).toBe('Space Settings')
    act(() => container.querySelector('button')!.click())
    expect(open).toHaveBeenCalledOnce()
  })
  it.each([
    [null, 'owner'],
    [{id: 'owner'}, 'owner'],
    [{id: 'owner', delegatedAccountUid: 'another-account'}, 'owner'],
    [{id: 'key', delegatedAccountUid: 'owner'}, 'another-space'],
  ])('hides settings for anonymous, legacy, and other-space readers', (identity, siteUid) => {
    state.identity = identity
    act(() => root.render(<WebSpaceSettingsMenuItem siteUid={siteUid} mobile={mobile} onSelect={vi.fn()} />))
    expect(container.textContent).toBe('')
    expect(container.querySelector('button')).toBeNull()
  })
})
