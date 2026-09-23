import {renderToStaticMarkup} from 'react-dom/server'
import {describe, expect, it} from 'vitest'
import {FooterWrapper} from '../footer'

describe('FooterWrapper', () => {
  it('uses a fixed height', () => {
    const markup = renderToStaticMarkup(<FooterWrapper>Footer</FooterWrapper>)

    expect(markup).toContain('h-6')
    expect(markup).not.toContain('min-h-6')
  })
})
