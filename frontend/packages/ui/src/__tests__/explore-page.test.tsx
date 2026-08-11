import {describe, expect, test} from 'vitest'
import {renderToStaticMarkup} from 'react-dom/server'
import {highlightExploreText} from '../explore-page'

describe('Explore highlighting', () => {
  test('highlights case-insensitive terms and phrases', () => {
    const html = renderToStaticMarkup(
      highlightExploreText('Engelbart wrote about search APIs', ['engelbart', '"search APIs"']),
    )
    expect(html).toContain('<mark')
    expect(html).toContain('Engelbart')
    expect(html).toContain('search APIs')
  })

  test('treats regex metacharacters as literal query text', () => {
    const html = renderToStaticMarkup(highlightExploreText('Use C++ (v2)', ['C++', '(v2)']))
    expect(html.match(/<mark/g)).toHaveLength(2)
  })
})
