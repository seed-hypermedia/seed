// @vitest-environment jsdom
import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {useQueryViewFilters} from '../use-query-view-filters'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const filters = [{columnId: 'metadata:Status', operator: 'notEquals' as const, value: 'Done'}]
const saved = JSON.stringify({filters})
let state: ReturnType<typeof useQueryViewFilters>
const element = document.createElement('div')
let root = createRoot(element)
const onChange = vi.fn()
function Harness(props: {scope?: string; view?: string; canEdit?: boolean}) {
  state = useQueryViewFilters({
    scope: props.scope ?? 'alice/tasks/query',
    view: props.view,
    canEdit: !!props.canEdit,
    onChange,
  })
  return null
}
function render(props: Parameters<typeof Harness>[0]) {
  act(() => root.render(<Harness {...props} />))
}
afterEach(() => {
  act(() => root.unmount())
  root = createRoot(element)
  onChange.mockClear()
})
describe('shared View editor/reader boundary', () => {
  it('starts from published filters in a fresh reader', () => {
    render({view: saved})
    expect(state[0]).toEqual(filters)
  })
  it('lets readers clear filters without calling a write path', () => {
    render({view: saved})
    act(() => state[1]([]))
    expect(state[0]).toEqual([])
    expect(onChange).not.toHaveBeenCalled()
  })
  it('resets temporary overrides when navigating or receiving a new saved View', () => {
    render({view: saved})
    act(() => state[1]([]))
    render({scope: 'other', view: saved})
    expect(state[0]).toEqual(filters)
    act(() => state[1]([]))
    render({scope: 'other', view: JSON.stringify({filters: [{...filters[0], value: 'Closed'}]})})
    expect(state[0][0]?.value).toBe('Closed')
  })
  it('routes authorized changes through the document draft callback', () => {
    render({canEdit: true})
    act(() => state[1](filters))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(saved)
    render({canEdit: true, view: saved})
    expect(state[0]).toEqual(filters)
  })
  it('does not call the writer after permission is revoked', () => {
    render({canEdit: true, view: saved})
    render({canEdit: false, view: saved})
    act(() => state[1]([]))
    expect(onChange).not.toHaveBeenCalled()
  })
})

it('does not carry a reader override to another version with identical saved filters', () => {
  render({scope: 'alice/tasks/v1/query', view: saved})
  act(() => state[1]([]))
  render({scope: 'alice/tasks/v2/query', view: saved})
  expect(state[0]).toEqual(filters)
  expect(onChange).not.toHaveBeenCalled()
})
