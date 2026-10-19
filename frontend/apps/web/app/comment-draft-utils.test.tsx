// @vitest-environment jsdom
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {useCommentDraftPersistence} from './comment-draft-utils'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let persistence: ReturnType<typeof useCommentDraftPersistence>
let root: Root
let container: HTMLDivElement
const blocks: HMBlockNode[] = [{block: {id: 'text', type: 'Paragraph', text: 'Unsent reply', attributes: {}}}]
const mediaRefs = {image: '{"url":"blob:upload"}'}
function Draft({parent = 'parent'}: {parent?: string}) {
  persistence = useCommentDraftPersistence('hm://doc', parent)
  return null
}
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  container = document.createElement('div')
  root = createRoot(container)
  act(() => root.render(<Draft />))
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})
it('restores unsaved text and media when the editor moves between panels', () => {
  persistence.saveDraft(blocks, mediaRefs)
  act(() => root.render(null))
  act(() => root.render(<Draft />))
  expect(persistence.draft).toEqual(blocks)
  expect(persistence.draftMediaRefs).toEqual(mediaRefs)
})
it('flushes a pending save to its original parent when the target changes', () => {
  persistence.saveDraft(blocks, mediaRefs)
  act(() => root.render(<Draft parent="other" />))
  expect(persistence.draft).toBeNull()
  act(() => root.render(<Draft />))
  expect(persistence.draft).toEqual(blocks)
  expect(persistence.draftMediaRefs).toEqual(mediaRefs)
})
it('persists a final editor callback after the persistence cleanup', () => {
  const save = persistence.saveDraft
  act(() => root.render(null))
  save(blocks, mediaRefs)
  act(() => root.render(<Draft />))
  expect(persistence.draft).toEqual(blocks)
  expect(persistence.draftMediaRefs).toEqual(mediaRefs)
})
it('does not restore a submitted draft during cleanup or a later timer', () => {
  persistence.saveDraft(blocks, mediaRefs)
  act(() => persistence.removeDraft())
  act(() => root.render(null))
  act(() => vi.runAllTimers())
  act(() => root.render(<Draft />))
  expect(persistence.draft).toBeNull()
  expect(persistence.draftMediaRefs).toBeNull()
})
