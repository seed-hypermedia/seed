// @vitest-environment jsdom
import React from 'react'
import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  documentCleanupItems,
  DocumentMaintenance,
  DocumentMaintenanceTrigger,
  DocumentMaintenanceBanner,
  type DocumentMaintenanceItem,
} from '../document-maintenance'
import type {DocumentCardCleanupJob} from '@shm/shared/models/document-card-cleanup-machine'
import {hmId} from '@shm/shared/utils/entity-id-url'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const baseItem: DocumentMaintenanceItem = {
  id: 'job',
  title: 'Add child card',
  needsAttention: true,
  status: 'Automatic attempts exhausted',
  error: 'Parent publication failed',
  documents: [{id: 'hm://alice/parent', label: '/parent'}],
  canRetry: true,
}
function render(items: DocumentMaintenanceItem[], props = {}, showSettings = false) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <DocumentMaintenance items={items} onRetry={vi.fn()} onDismiss={vi.fn()} onOpenDocument={vi.fn()} {...props}>
        <nav aria-label="Sidebar">
          <DocumentMaintenanceTrigger />
        </nav>
        <main>
          <DocumentMaintenanceBanner />
        </main>
        {showSettings && (
          <aside>
            <DocumentMaintenanceTrigger alwaysVisible />
          </aside>
        )}
      </DocumentMaintenance>,
    ),
  )
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent === label)
  expect(button, label).toBeTruthy()
  await act(async () => button!.click())
}
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.unstubAllGlobals()
})
describe('document maintenance recovery', () => {
  it('hides completed work but keeps failed and pending actions reachable', () => {
    const base = {
      id: 'job',
      source: hmId('alice', {path: ['parent', 'child']}),
      signingAccountUid: 'alice',
      attempts: 4,
      maxRetries: 3,
      createdAt: 1,
      updatedAt: 1,
    } as DocumentCardCleanupJob
    const items = documentCleanupItems([
      {...base, state: 'done'},
      {...base, id: 'pending', state: 'retryScheduled'},
      {...base, id: 'failed', state: 'failedNeedsAttention'},
    ])
    expect(items.map((item) => item.id)).toEqual(['pending', 'failed'])
    expect(items[0]?.canRetry).toBe(false)
    expect(items[1]?.canRetry).toBe(true)
  })
  it('requires review instead of retry when a deletion scope changed', () => {
    const job = {
      id: 'deletion',
      operation: 'delete-child',
      source: hmId('alice', {path: ['parent', 'child']}),
      state: 'failedNeedsAttention',
      attempts: 1,
      publishedVersion: 'corrected-version',
      lastError: 'Confirmation required: descendants changed',
    } as DocumentCardCleanupJob
    const item = documentCleanupItems([job])[0]
    expect(item?.canRetry).toBe(false)
    expect(item?.title).toBe('Delete confirmed child document')
    expect(item?.progress).toEqual(['Parent published at corrected-version'])
  })
  it('keeps the page mounted and hides both entry points when the queue is empty', () => {
    render([])
    expect(container.querySelector('nav')).not.toBeNull()
    expect(container.querySelector('main')).not.toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })
  it('opens the same dialog from the sidebar and notification banner without a floating button', async () => {
    render([baseItem])
    expect(container.querySelector('nav button')?.textContent).toBe('Needs attention (1)')
    expect(container.querySelector('.fixed')).toBeNull()
    const banner = container.querySelector<HTMLButtonElement>('main button')!
    expect(banner.textContent).toContain('1 action needs your attention')
    await act(async () => banner.click())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Parent publication failed')
  })
  it('distinguishes pending automatic work from failures', () => {
    render([{...baseItem, needsAttention: false}])
    expect(container.querySelector('nav button')?.textContent).toBe('Document maintenance (1)')
    expect(container.querySelector('main button')?.textContent).toContain('1 document action is in progress')
  })
  it('keeps queue-loading failures reachable even without loaded jobs', async () => {
    render([], {loadError: 'Storage unavailable'})
    await click('Needs attention')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable')
  })
  it('returns keyboard focus to the entry point when the dialog closes', async () => {
    render([baseItem])
    const trigger = container.querySelector<HTMLButtonElement>('nav button')!
    await click('Needs attention (1)')
    await click('Close')
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  })
  it('opens empty maintenance history from settings without warning badges', async () => {
    render([], {}, true)
    expect(container.querySelector('nav button')).toBeNull()
    expect(container.querySelector('main button')).toBeNull()
    await click('Document maintenance')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await click('Dismissed (0)')
    expect(document.body.textContent).toContain('No dismissed actions')
  })
  it('keeps dismissed actions in history without counting them as attention or pending work', async () => {
    render([{...baseItem, needsAttention: false, dismissedAt: 1000}])
    expect(container.querySelector('main button')).toBeNull()
    await click('Document maintenance')
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Parent publication failed')
    await click('Dismissed (1)')
    expect(document.body.textContent).toContain('Parent publication failed')
    expect(document.body.textContent).toContain('Dismissed without repairing')
    expect(document.body.textContent).toContain('Review and retry')
  })
  it('clears only dismissed history after explicit confirmation', async () => {
    const clear = vi.fn()
    render([{...baseItem, needsAttention: false, dismissedAt: 1000}], {onClearDismissed: clear})
    await click('Document maintenance')
    await click('Dismissed (1)')
    await click('Clear history…')
    expect(clear).not.toHaveBeenCalled()
    await click('Clear dismissed history')
    expect(clear).toHaveBeenCalledOnce()
  })
  it('copies diagnostics only on request and never includes signing capability data', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {clipboard: {writeText: copy}})
    const items = documentCleanupItems([
      {
        id: 'history',
        operation: 'remove',
        source: hmId('alice', {path: ['parent', 'child']}),
        state: 'dismissed',
        dismissedAt: 1000,
        attempts: 4,
        maxRetries: 3,
        createdAt: 1,
        updatedAt: 1000,
        signingAccountUid: 'alice',
        capabilityId: 'private-capability',
        lastError: 'offline',
      },
    ])
    render(items)
    await click('Document maintenance')
    await click('Dismissed (1)')
    expect(copy).not.toHaveBeenCalled()
    await click('Copy diagnostic report')
    expect(copy).toHaveBeenCalledOnce()
    const report = copy.mock.calls[0]![0] as string
    expect(report).toContain('offline')
    expect(report).toContain('dismissedAt')
    expect(report).not.toContain('private-capability')
  })
  it('shows errors, opens affected documents, and retries explicitly', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const open = vi.fn()
    render([baseItem], {onRetry: retry, onOpenDocument: open})
    await click('Needs attention (1)')
    expect(document.body.textContent).toContain('Parent publication failed')
    await click('Review /parent')
    expect(open).toHaveBeenCalledWith('hm://alice/parent')
    await click('Retry')
    expect(retry).toHaveBeenCalledWith('job')
  })
  it('requires explicit acknowledgment before dismissing without repair', async () => {
    const dismiss = vi.fn().mockResolvedValue(undefined)
    render([baseItem], {onDismiss: dismiss})
    await click('Needs attention (1)')
    await click('Dismiss…')
    expect(dismiss).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('References may remain out of date')
    await click('Dismiss without repairing')
    expect(dismiss).toHaveBeenCalledWith('job')
  })
  it('never offers generic retry when destructive consent requires review', async () => {
    render([{...baseItem, canRetry: false}])
    await click('Needs attention (1)')
    expect(Array.from(document.querySelectorAll('button')).some((node) => node.textContent === 'Retry')).toBe(false)
    expect(document.body.textContent).toContain('confirm the current deletion scope')
  })
  it('loads exact deletion versions and requires a separate destructive confirmation', async () => {
    const documents = [
      {id: 'hm://alice/parent/child', version: 'version-reviewed'},
      {id: 'hm://alice/parent/child/new', version: 'new-version'},
    ]
    const review = vi.fn().mockResolvedValue(documents)
    const confirm = vi.fn().mockResolvedValue(undefined)
    render([{...baseItem, canRetry: false, canReviewDeletion: true}], {
      onReviewDeletion: review,
      onConfirmDeletion: confirm,
    })
    await click('Needs attention (1)')
    await click('Review deletion')
    expect(review).toHaveBeenCalledWith('job')
    expect(confirm).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Version: version-reviewed')
    expect(document.body.textContent).toContain('hm://alice/parent/child/new')
    await click('Confirm deletion of 2 documents')
    expect(confirm).toHaveBeenCalledWith('job', documents)
  })
  it('allows cancelling renewed deletion consent without retrying', async () => {
    const confirm = vi.fn()
    render([{...baseItem, canRetry: false, canReviewDeletion: true}], {
      onReviewDeletion: vi.fn().mockResolvedValue([{id: 'hm://alice/child', version: 'v1'}]),
      onConfirmDeletion: confirm,
    })
    await click('Needs attention (1)')
    await click('Review deletion')
    await click('Cancel deletion review')
    expect(confirm).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Confirm deletion of 1 document')
  })
  it('keeps errors from retry visible without dismissing the action', async () => {
    render([baseItem], {onRetry: vi.fn().mockRejectedValue(new Error('Storage unavailable'))})
    await click('Needs attention (1)')
    await click('Retry')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable')
  })
})

vi.mock('../document-deletion-references', () => ({DocumentDeletionReferences: () => null}))
