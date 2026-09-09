// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {expect, it, vi} from 'vitest'
import {DocumentDeletionReferences} from '../document-deletion-references'
;(globalThis as any).React = React
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const {request} = vi.hoisted(() => ({request: vi.fn()}))
vi.mock('@shm/shared/routing', () => {
  const client = {request}
  return {useUniversalClient: () => client}
})

it('checks descendants, excludes internal sources, deduplicates documents and warns that links break', async () => {
  request.mockImplementation(async (key, input) => {
    if (key === 'Resource') return {type: 'document', document: {metadata: {name: 'External document'}}}
    const {targetId} = input
    return {
      citations: [
        {source: 'hm://alice/elsewhere?v=v1#block'},
        {source: 'hm://alice/elsewhere?v=v2'},
        {source: 'hm://alice/child/nested'},
        {source: targetId.path.length === 1 ? 'hm://alice?v=parent-version#block' : 'hm://alice/child?v=v1'},
        {source: 'hm://comment', sourceDocument: targetId.path.length === 1 ? 'hm://alice' : 'hm://alice/child'},
        ...(targetId.path.length > 1 ? [{source: 'hm://bob/other'}] : []),
      ],
    }
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () =>
    root.render(<DocumentDeletionReferences documentIds={['hm://alice/child', 'hm://alice/child/nested']} />),
  )
  expect(request.mock.calls.filter(([key]) => key === 'ListCitations')).toHaveLength(2)
  expect(container.textContent).toContain('Known references (2)')
  expect(container.textContent).toContain('will break')
  expect(container.querySelectorAll('a')).toHaveLength(0)
  const toggle = container.querySelector('button')!
  expect(toggle.textContent).toBe('Show')
  act(() => toggle.click())
  expect(toggle.textContent).toBe('Hide')
  expect(container.querySelectorAll('a')).toHaveLength(2)
  expect(container.textContent).toContain('External document')
  expect(container.querySelector('details')).toBeNull()
  expect(container.textContent).not.toContain('nested')
  act(() => root.unmount())
})

it('shows partial results and a lookup failure without claiming no references', async () => {
  request.mockImplementation(async (_key, {targetId}) => {
    if (targetId.path.length > 1) throw new Error('offline')
    return {citations: [{source: 'hm://bob/other'}]}
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () =>
    root.render(<DocumentDeletionReferences documentIds={['hm://alice/child', 'hm://alice/child/nested']} />),
  )
  expect(container.textContent).toContain('Could not check')
  expect(container.textContent).toContain('Known references (1)')
  expect(container.textContent).not.toContain('No known references')
  act(() => root.unmount())
})

it('shows loading, then an honest empty result, and hides stale results when the deletion scope changes', async () => {
  let resolve!: (value: {citations: {source: string}[]}) => void
  request.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<DocumentDeletionReferences documentIds={['hm://alice/child']} />))
  expect(container.textContent).toContain('Checking known references')
  await act(async () => resolve({citations: []}))
  expect(container.textContent).toContain('No known references found')
  await act(async () => root.render(<DocumentDeletionReferences documentIds={['hm://alice/other']} />))
  expect(container.textContent).toContain('Checking known references')
  expect(container.textContent).not.toContain('No known references found')
  act(() => root.unmount())
  // An in-flight response after closing the dialog must be ignored.
  await act(async () => resolve({citations: [{source: 'hm://bob/source'}]}))
  expect(container.textContent).toBe('')
})

it('excludes only the target’s direct parent, not ancestors or parents of other deletion targets', async () => {
  request.mockImplementation(async (key) => {
    if (key === 'Resource') throw new Error('title unavailable')
    return {citations: [{source: 'hm://alice/parent?v=v1#block'}, {source: 'hm://alice'}, {source: 'hm://bob/parent'}]}
  })
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<DocumentDeletionReferences documentIds={['hm://alice/parent/child']} />))
  expect(container.textContent).toContain('Known references (2)')
  act(() => container.querySelector('button')!.click())
  const links = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))
  expect(links).toEqual(['hm://alice', 'hm://bob/parent'])
  expect(container.textContent).not.toContain('Could not check')
  act(() => root.unmount())
})
