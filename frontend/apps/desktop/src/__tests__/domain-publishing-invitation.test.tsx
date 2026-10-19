import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {DomainPublishingInvitation} from '../components/domain-publishing-invitation'
import {
  domainPublishingInvitation,
  inviteToPublishDomain,
  setDomainPublishingInvitation,
} from '../models/domain-publishing-invitation'

const {openPublish} = vi.hoisted(() => ({openPublish: vi.fn()}))
vi.mock('@/components/publish-site', () => ({
  usePublishSite: () => ({open: openPublish, content: null}),
}))

let root: Root
let container: HTMLDivElement

function render(page = 'draft') {
  act(() => {
    root.render(
      <>
        <div key={page}>{page}</div>
        <DomainPublishingInvitation />
      </>,
    )
  })
}

function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label)
  expect(button).toBeDefined()
  act(() => button!.click())
}

describe('first space publication invitation', () => {
  beforeEach(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    setDomainPublishingInvitation(null)
    openPublish.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    setDomainPublishingInvitation(null)
  })

  it('retains the invitation across draft-to-document navigation and starts hosting for that space', () => {
    const id = hmId('new-space')
    render()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => inviteToPublishDomain(id))
    render('published-document')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Your space is published')
    click('Publish to a Domain')
    expect(openPublish).toHaveBeenCalledWith({id})
    expect(domainPublishingInvitation.get()).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('allows deferring hosting and does not repeat a dismissed invitation', () => {
    const id = hmId('deferred-space')
    render()
    act(() => inviteToPublishDomain(id))
    click('Not now')
    expect(openPublish).not.toHaveBeenCalled()
    act(() => inviteToPublishDomain(id))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('retains a publication that finishes before the host mounts and supports closing the dialog', () => {
    inviteToPublishDomain(hmId('early-space'))
    render()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    click('Close')
    expect(domainPublishingInvitation.get()).toBeNull()
    expect(openPublish).not.toHaveBeenCalled()
  })
})
