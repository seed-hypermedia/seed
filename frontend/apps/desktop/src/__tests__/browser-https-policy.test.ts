// @vitest-environment node
import {describe, expect, it} from 'vitest'
import {
  InsecureOrigins,
  browserInsecurePage,
  httpsAttempt,
  httpsVersion,
  isInsecureUrl,
  isLoopbackUrl,
} from '../browser-https-policy'

describe('https first', () => {
  it('tries the encrypted address before any plain http request', () => {
    const allowed = new InsecureOrigins()
    expect(httpsAttempt('http://example.com/a?b=1#c', allowed)).toBe('https://example.com/a?b=1#c')
    expect(httpsAttempt('http://example.com:8080/', allowed)).toBe('https://example.com:8080/')
    expect(httpsAttempt('http://user:pw@example.com/', allowed)).toBe('https://user:pw@example.com/')
    expect(httpsVersion('http://example.com:80/')).toBe('https://example.com/')
  })

  it('loads https, loopback and Seed addresses as they are', () => {
    const allowed = new InsecureOrigins()
    expect(httpsAttempt('https://example.com/', allowed)).toBeNull()
    expect(httpsAttempt('http://localhost:3000/', allowed)).toBeNull()
    expect(httpsAttempt('http://app.localhost/', allowed)).toBeNull()
    expect(httpsAttempt('http://127.0.0.1:58001/', allowed)).toBeNull()
    expect(httpsAttempt('http://127.1/', allowed)).toBeNull()
    expect(httpsAttempt('http://[::1]:8080/', allowed)).toBeNull()
    expect(httpsAttempt('hm://alice/docs', allowed)).toBeNull()
    expect(httpsAttempt('not a url', allowed)).toBeNull()
  })

  it('treats the local network and look-alike names as insecure, not loopback', () => {
    expect(isLoopbackUrl('http://192.168.1.10/')).toBe(false)
    expect(isLoopbackUrl('http://10.0.0.1/')).toBe(false)
    expect(isLoopbackUrl('http://localhost.evil.example/')).toBe(false)
    expect(isLoopbackUrl('http://notlocalhost/')).toBe(false)
    expect(isInsecureUrl('http://192.168.1.10/')).toBe(true)
    expect(isInsecureUrl('http://seed-insecure.test:1234/')).toBe(true)
  })

  it('judges the committed page only: a redirect chain that ends on https is secure', () => {
    // The main process reports the committed URL after redirects; http hops are never committed.
    expect(isInsecureUrl('https://example.com/')).toBe(false)
    expect(isInsecureUrl('http://example.com/')).toBe(true)
    expect(isInsecureUrl('http://localhost/')).toBe(false)
    expect(isInsecureUrl('data:text/html,hi')).toBe(false)
  })
})

describe('insecure opt-in', () => {
  it('remembers the origin, not the page, for the session and forgets it when cleared', () => {
    const allowed = new InsecureOrigins()
    expect(httpsAttempt('http://example.com/a', allowed)).not.toBeNull()
    allowed.allow('http://example.com/a')
    expect(allowed.allows('http://example.com/b?x')).toBe(true)
    expect(httpsAttempt('http://example.com/b?x', allowed)).toBeNull()
    expect(httpsAttempt('http://example.com:8080/', allowed)).not.toBeNull()
    expect(httpsAttempt('http://www.example.com/', allowed)).not.toBeNull()
    expect(allowed.allows('https://example.com/')).toBe(false)
    allowed.clear()
    expect(httpsAttempt('http://example.com/a', allowed)).toBe('https://example.com/a')
  })

  it('keeps normal and private opt-ins apart', () => {
    const normal = new InsecureOrigins()
    const privately = new InsecureOrigins()
    normal.allow('http://example.com/')
    expect(normal.allows('http://example.com/')).toBe(true)
    expect(privately.allows('http://example.com/')).toBe(false)
    privately.allow('http://other.example/')
    expect(normal.allows('http://other.example/')).toBe(false)
  })

  it('ignores addresses that are not plain http', () => {
    const allowed = new InsecureOrigins()
    allowed.allow('https://example.com/')
    allowed.allow('not a url')
    expect(allowed.allows('http://example.com/')).toBe(false)
  })
})

describe('insecure warning page', () => {
  it('is a script-free page with a thick red frame, the host, and the two choices', () => {
    const page = browserInsecurePage('http://evil.example:8080/path?q=<script>')
    expect(page.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    const html = decodeURIComponent(page.slice('data:text/html;charset=utf-8,'.length))
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('border:16px solid #ff0000')
    expect(html).toContain('evil.example:8080 is not encrypted')
    expect(html).not.toContain('<script>')
    expect(html).toContain('href="seed-browser://allow-insecure"')
    expect(html).toContain('href="seed-browser://back"')
    expect(html).toContain('Show the page anyway')
    expect(html).toContain('Go back')
  })
})
