// @vitest-environment jsdom
import React from 'react'
import {describe, expect, it, vi} from 'vitest'
import {copyBestAvailableLink, createCopyLinkMenuItem} from '../copy-link-menu'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React

describe('copyBestAvailableLink', () => {
  it('copies the canonical link first when available', async () => {
    const canonical = vi.fn()
    const gateway = vi.fn()
    const hypermedia = vi.fn()

    await copyBestAvailableLink({canonical, gateway, hypermedia})

    expect(canonical).toHaveBeenCalledOnce()
    expect(gateway).not.toHaveBeenCalled()
    expect(hypermedia).not.toHaveBeenCalled()
  })

  it('falls back to gateway before hypermedia', async () => {
    const gateway = vi.fn()
    const hypermedia = vi.fn()

    await copyBestAvailableLink({canonical: null, gateway, hypermedia})

    expect(gateway).toHaveBeenCalledOnce()
    expect(hypermedia).not.toHaveBeenCalled()
  })

  it('falls back to hypermedia when no web URL is available', async () => {
    const hypermedia = vi.fn()

    await copyBestAvailableLink({canonical: null, gateway: null, hypermedia})

    expect(hypermedia).toHaveBeenCalledOnce()
  })
})

describe('createCopyLinkMenuItem', () => {
  it('creates a direct copy action by default', async () => {
    const canonical = vi.fn()
    const item = createCopyLinkMenuItem({
      advanced: false,
      label: 'Copy Link',
      canonical: {copy: canonical},
      gateway: null,
      hypermedia: {copy: vi.fn()},
    })

    expect(item.children).toBeUndefined()
    await item.onClick?.({stopPropagation: vi.fn()} as any)

    expect(canonical).toHaveBeenCalledOnce()
  })

  it('creates explicit URL choices when advanced options are enabled', () => {
    const item = createCopyLinkMenuItem({
      advanced: true,
      label: 'Copy Link',
      canonical: {copy: vi.fn(), label: 'Copy Canonical URL'},
      gateway: {copy: vi.fn(), label: 'Copy Gateway URL'},
      hypermedia: {copy: vi.fn(), label: 'Copy Hypermedia URL'},
    })

    expect(item.children?.map((child) => child.label)).toEqual([
      'Copy Canonical URL',
      'Copy Gateway URL',
      'Copy Hypermedia URL',
    ])
  })
})
