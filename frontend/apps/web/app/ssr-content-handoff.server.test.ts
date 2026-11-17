import {describe, expect, it} from 'vitest'
import {omitSSRContentHTML} from './ssr-content-handoff.server'

describe('SSR content handoff', () => {
  it('omits only the route HTML copy without changing data used by SSR', () => {
    const payload = {json: {ssrContentHTML: '<p>Hello</p>', document: {version: 'v1'}, dehydratedState: {queries: []}}}
    const context = {state: {loaderData: {root: {json: {name: 'Site'}}, 'routes/$': payload, other: null}}, future: {}}
    const result = JSON.parse(omitSSRContentHTML(JSON.stringify(context)))
    expect(result.state.loaderData['routes/$'].json).toEqual({
      document: {version: 'v1'},
      dehydratedState: {queries: []},
    })
    expect(result.state.loaderData.root).toEqual(context.state.loaderData.root)
    expect(result.state.loaderData.other).toBeNull()
    expect(result.future).toEqual({})
    expect(payload.json.ssrContentHTML).toBe('<p>Hello</p>')
  })

  it('preserves script-safe escaping for the remaining loader data', () => {
    const text = '</script><script>alert("x")</script>&\u2028\u2029'
    const result = omitSSRContentHTML(
      JSON.stringify({state: {loaderData: {route: {json: {ssrContentHTML: 'html', text}}}}}),
    )
    expect(result).not.toMatch(/[<>&\u2028\u2029]/)
    expect(JSON.parse(result).state.loaderData.route.json.text).toBe(text)
  })

  it('leaves non-document and hidden-content handoffs unchanged', () => {
    for (const handoff of [{}, {state: {loaderData: {route: {json: {ssrContentHTML: null}}}}}]) {
      const serialized = JSON.stringify(handoff)
      expect(omitSSRContentHTML(serialized)).toBe(serialized)
    }
  })
})
