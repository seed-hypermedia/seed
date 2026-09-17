import React, {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act, Simulate} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {AgentTriggerSource} from '@seed-hypermedia/agents-protocol'

const resolution = vi.hoisted(() => ({loading: false, missing: false}))
vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: resolution.missing ? null : {metadata: {name: 'Alice'}}, isLoading: resolution.loading}),
  useResource: (id: {path?: string[]}) => ({
    data: resolution.missing
      ? null
      : {type: 'document', document: {metadata: {name: id?.path?.[0] === 'b' ? 'Roadmap' : 'Project plan'}}},
    isLoading: resolution.loading,
  }),
}))
vi.mock('@shm/shared/models/search', () => ({
  useSearch: (query: string) => ({
    data: {
      entities: query
        ? [
            {
              id: {id: 'hm://site/c', uid: 'site', path: ['c']},
              type: 'document',
              title: 'Design review',
              parentNames: ['Team space'],
            },
            {id: {id: 'hm://alice', uid: 'alice', path: []}, type: 'contact', title: 'Alice', parentNames: []},
          ]
        : [],
    },
  }),
}))
import {TriggerSourceFields} from '@shm/ui/agents/trigger-types'

let container: HTMLDivElement
let root: Root
const changed = vi.fn()
const drafting = vi.fn()
const original: AgentTriggerSource = {
  type: 'activity',
  conditions: [
    {id: 'a', source: {type: 'document-comment', resource: 'hm://site/a'}},
    {id: 'b', source: {type: 'document-comment', resource: 'hm://site/b'}},
  ],
}

function Editor({initial = original}: {initial?: AgentTriggerSource}) {
  const [source, setSource] = useState(initial)
  return (
    <TriggerSourceFields
      source={source}
      onDraftChange={drafting}
      onChange={(next) => {
        changed(next)
        setSource(next)
      }}
    />
  )
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  resolution.loading = false
  resolution.missing = false
  changed.mockClear()
  drafting.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Editor />))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function buttons(label: string, scope: ParentNode = document.body) {
  return Array.from(scope.querySelectorAll('button')).filter((button) => button.textContent === label)
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]')!
}

function typeSearch(kind: 'documents' | 'accounts', value: string) {
  const input = dialog().querySelector<HTMLInputElement>(`input[placeholder^="Search ${kind}"]`)!
  act(() => {
    input.value = value
    Simulate.change(input)
  })
  return input
}

describe('activity condition editor', () => {
  it('uses a dialog and only commits a selected search result, keeping existing condition IDs', () => {
    expect(container.textContent).toContain('Project plan')
    expect(container.textContent).toContain('Roadmap')
    expect(container.textContent).not.toContain('hm://')
    expect(container.textContent).not.toContain('If the same event matches')
    expect(dialog()).toBeNull()
    act(() => buttons('Add condition')[0]!.click())
    expect(dialog()).not.toBeNull()
    expect(drafting).toHaveBeenLastCalledWith(true)
    const input = typeSearch('documents', 'Design')
    expect(buttons('Add condition', dialog())[0]!.disabled).toBe(true)
    expect(dialog().textContent).toContain('Design review')
    expect(dialog().textContent).toContain('Team space')
    expect(dialog().textContent).not.toContain('hm://')
    expect(changed).not.toHaveBeenCalled()
    act(() => Simulate.keyDown(input, {key: 'Enter'}))
    expect(buttons('Add condition', dialog())[0]!.disabled).toBe(false)
    act(() => buttons('Add condition', dialog())[0]!.click())
    expect(changed).toHaveBeenCalledTimes(1)
    const next = changed.mock.calls[0]![0] as Extract<AgentTriggerSource, {type: 'activity'}>
    expect(next.conditions.slice(0, 2)).toEqual(original.type === 'activity' ? original.conditions : [])
    expect(next.conditions[2]?.source).toEqual({type: 'document-comment', resource: 'hm://site/c'})
    expect(next.conditions[2]?.id).toBeTruthy()
    expect(drafting).toHaveBeenLastCalledWith(false)
    expect(dialog()).toBeNull()
  })

  it('resolves saved names, cancels local edits, and cannot remove the last condition', () => {
    act(() => buttons('Edit')[0]!.click())
    expect(dialog().querySelector<HTMLInputElement>('input[placeholder^="Search documents"]')?.value).toBe(
      'Project plan',
    )
    expect(dialog().textContent).not.toContain('hm://')
    expect(buttons('Change', dialog())).toHaveLength(0)
    typeSearch('documents', '')
    expect(buttons('Save condition', dialog())[0]!.disabled).toBe(true)
    act(() => buttons('Cancel', dialog())[0]!.click())
    expect(changed).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Project plan')
    act(() => buttons('Remove')[0]!.click())
    expect(changed).toHaveBeenLastCalledWith({
      type: 'activity',
      conditions: [{id: 'b', source: {type: 'document-comment', resource: 'hm://site/b'}}],
    })
    expect(buttons('Remove')).toHaveLength(0)
  })

  it('autocompletes author filters and stores the account identity without displaying it', () => {
    act(() => buttons('Edit')[0]!.click())
    const input = typeSearch('accounts', 'Ali')
    expect(dialog().textContent).toContain('Alice')
    act(() => Simulate.keyDown(input, {key: 'Enter'}))
    act(() => buttons('Save condition', dialog())[0]!.click())
    expect(changed.mock.calls[0]![0].conditions[0].source.author).toBe('alice')
    expect(container.textContent).toContain('by Alice')
  })

  it('resolves mentioned accounts and scope, and allows adding another named account', () => {
    act(() =>
      root.render(
        <Editor
          key="mentions"
          initial={{type: 'user-mention', mentionedAccounts: ['bob'], resourcePrefix: 'hm://site/a'}}
        />,
      ),
    )
    expect(container.textContent).toContain('Mention of Alice in Project plan')
    act(() => buttons('Edit')[0]!.click())
    expect(dialog().textContent).not.toContain('bob')
    expect(dialog().textContent).not.toContain('hm://')
    const input = typeSearch('accounts', 'Ali')
    act(() => Simulate.keyDown(input, {key: 'Enter'}))
    act(() => buttons('Save condition', dialog())[0]!.click())
    expect(changed).toHaveBeenLastCalledWith({
      type: 'user-mention',
      mentionedAccounts: ['bob', 'alice'],
      resourcePrefix: 'hm://site/a',
    })
  })

  it('replaces a selected target by typing directly and blocks saving an unresolved search', () => {
    act(() => buttons('Edit')[0]!.click())
    const input = typeSearch('documents', 'Design')
    expect(buttons('Change', dialog())).toHaveLength(0)
    expect(buttons('Save condition', dialog())[0]!.disabled).toBe(true)
    act(() => Simulate.blur(input))
    expect(buttons('Save condition', dialog())[0]!.disabled).toBe(true)
    act(() => Simulate.focus(input))
    act(() => Simulate.keyDown(input, {key: 'Enter'}))
    act(() => buttons('Save condition', dialog())[0]!.click())
    expect(changed.mock.calls[0]![0].conditions[0]).toEqual({
      id: 'a',
      source: {type: 'document-comment', resource: 'hm://site/c'},
    })
  })

  it('splits legacy event filters into independent editable conditions without changing them on read', () => {
    act(() =>
      root.render(
        <Editor
          key="events"
          initial={{type: 'site-update', resourcePrefix: 'hm://site/a', eventTypes: ['doc-update', 'comment']}}
        />,
      ),
    )
    expect(container.textContent).toContain('Document updated in Project plan')
    expect(container.textContent).toContain('Comment posted in Project plan')
    expect(buttons('Edit')).toHaveLength(2)
    expect(changed).not.toHaveBeenCalled()
    act(() => buttons('Edit')[0]!.click())
    expect(dialog().textContent).not.toContain('Event types')
    expect(dialog().textContent).not.toContain('Space update')
    const input = typeSearch('documents', 'Design')
    act(() => Simulate.keyDown(input, {key: 'Enter'}))
    act(() => buttons('Save condition', dialog())[0]!.click())
    const next = changed.mock.calls[0]![0] as Extract<AgentTriggerSource, {type: 'activity'}>
    expect(next.conditions.map(({source}) => source)).toEqual([
      {type: 'site-update', resourcePrefix: 'hm://site/c', eventTypes: ['doc-update']},
      {type: 'site-update', resourcePrefix: 'hm://site/a', eventTypes: ['comment']},
    ])
    expect(new Set(next.conditions.map(({id}) => id)).size).toBe(2)
  })

  it('offers specific event conditions and retains the target when switching event type', () => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    act(() => buttons('Edit')[0]!.click())
    const select = dialog().querySelector<HTMLButtonElement>('button[role="combobox"]')!
    act(() => Simulate.keyDown(select, {key: 'Enter'}))
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(options.map((option) => option.textContent)).toContain('Document updated')
    expect(options.map((option) => option.textContent)).toContain('Comment posted')
    expect(options.map((option) => option.textContent)).not.toContain('Space update')
    const option = options.find((option) => option.textContent === 'Document updated')!
    act(() => Simulate.keyDown(option, {key: 'Enter'}))
    expect(dialog().textContent).not.toContain('Event types')
    act(() => buttons('Save condition', dialog())[0]!.click())
    expect(changed.mock.calls[0]![0].conditions[0].source).toEqual({
      type: 'site-update',
      resourcePrefix: 'hm://site/a',
      eventTypes: ['doc-update'],
    })
  })

  it('preserves unfiltered legacy activity conditions rather than narrowing them to document updates', () => {
    act(() => root.render(<Editor key="all-events" initial={{type: 'site-update', resourcePrefix: 'hm://site/a'}} />))
    act(() => buttons('Edit')[0]!.click())
    expect(dialog().textContent).toContain('Any activity')
    expect(dialog().textContent).not.toContain('Event types')
    act(() => buttons('Save condition', dialog())[0]!.click())
    expect(changed).toHaveBeenLastCalledWith({type: 'site-update', resourcePrefix: 'hm://site/a'})
  })

  it('uses loading and unavailable labels instead of falling back to raw IDs', () => {
    resolution.missing = true
    resolution.loading = true
    act(() => root.render(<Editor key="loading" />))
    expect(container.textContent).toContain('Loading document…')
    expect(container.textContent).not.toContain('hm://')
    resolution.loading = false
    act(() => root.render(<Editor key="missing" />))
    expect(container.textContent).toContain('Unavailable document')
    expect(container.textContent).not.toContain('hm://')
  })
})
