import {describe, expect, it} from 'vitest'
import {frameNavigationOpensExternally} from '../frame-navigation'

describe('frameNavigationOpensExternally', () => {
  it('keeps local documents inside the window', () => {
    for (const url of [
      'data:text/html;base64,PGgxPmhpPC9oMT4=',
      'about:srcdoc',
      'about:blank',
      'blob:http://localhost:3000/3f1c2b7e-0a9d-4c4e-9b6d-2f0e5c1a8d77',
    ])
      expect(frameNavigationOpensExternally(url), url).toBe(false)
  })
  it('lets the known embed services load in frames', () => {
    for (const url of [
      'https://www.youtube.com/embed/abc',
      'https://www.youtube-nocookie.com/embed/abc',
      'https://platform.twitter.com/embed/Tweet.html?id=1',
      'https://www.instagram.com/p/abc/embed',
    ])
      expect(frameNavigationOpensExternally(url), url).toBe(false)
  })
  it('sends any other website out to the system browser', () => {
    for (const url of ['https://example.com/', 'http://evil.test/phish', 'HTTPS://EXAMPLE.COM'])
      expect(frameNavigationOpensExternally(url), url).toBe(true)
  })
})
