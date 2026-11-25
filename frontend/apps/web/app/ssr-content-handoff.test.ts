// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest'
import {omitSSRContentHTML, restoreSSRContentHTML} from './ssr-content-handoff'
import {unwrap} from './wrapping'

afterEach(() => {
  document.body.innerHTML = ''
})

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

  it('restores the DOM content into loader data so it survives component remounts', () => {
    const html = '<div class="ssr-content-placeholder"><p>Hello &amp; goodbye</p></div>'
    const loaderData = {
      root: {json: {name: 'Site'}},
      'routes/$': {json: {document: {version: 'v1'}, ssrContentHTML: html}},
    }
    document.body.innerHTML = `<main><div class="relative"><div>${html}</div></div></main>`
    const handoff = JSON.parse(omitSSRContentHTML(JSON.stringify({state: {loaderData}})))
    expect(handoff.state.loaderData['routes/$'].json.ssrContentHTML).toBeUndefined()
    const originalDOM = document.body.innerHTML

    restoreSSRContentHTML(handoff.state.loaderData, document)
    const payload = handoff.state.loaderData['routes/$']
    expect(unwrap(payload)).toEqual({document: {version: 'v1'}, ssrContentHTML: html})
    expect(document.body.innerHTML).toBe(originalDOM)
    expect(handoff.state.loaderData.root).toEqual(loaderData.root)

    document.body.innerHTML = ''
    restoreSSRContentHTML(handoff.state.loaderData, document)
    expect(unwrap(payload)).toEqual({document: {version: 'v1'}, ssrContentHTML: html})
  })

  it('does not add content to hidden panels or overwrite navigation HTML', () => {
    document.body.innerHTML = '<div class="ssr-content-placeholder">Initial content</div>'
    const loaderData = {
      panel: {json: {document: {}, ssrContentHTML: null}},
      navigation: {json: {document: {}, ssrContentHTML: '<p>New document</p>'}},
      unrelated: {json: {document: null}},
      other: null,
    }
    const originalData = JSON.stringify(loaderData)
    restoreSSRContentHTML(loaderData, document)
    expect(JSON.stringify(loaderData)).toBe(originalData)
  })

  it('leaves loader data alone when the server did not render content', () => {
    const loaderData = {'routes/$': {json: {document: {}}}}
    restoreSSRContentHTML(loaderData, document)
    expect(loaderData['routes/$'].json).not.toHaveProperty('ssrContentHTML')
  })
})
