import {describe, expect, it} from 'vitest'
import {parseRequest} from './request'

describe('parseRequest public target', () => {
  it('uses Host rather than the caller Origin embedded in the development adapter URL', () => {
    const result = parseRequest(
      new Request('http://localhost:3001/hm/api/register?setup=1', {
        method: 'POST',
        headers: {Host: 'foo.localhost:3000', Origin: 'http://localhost:3001'},
      }),
    )
    expect(result.hostname).toBe('foo.localhost')
    expect(result.origin).toBe('http://foo.localhost:3000')
    expect(result.url.href).toBe('http://foo.localhost:3000/hm/api/register?setup=1')
    expect(result.method).toBe('POST')
    expect(result.searchParams.get('setup')).toBe('1')
  })

  it('prefers the forwarded public host and protocol over the internal Host and URL', () => {
    const result = parseRequest(
      new Request('http://internal:3000/a/b/?q=hello%20world', {
        headers: {Host: 'internal:3000', 'X-Forwarded-Host': 'space.hyper.media', 'X-Forwarded-Proto': 'https'},
      }),
    )
    expect(result.hostname).toBe('space.hyper.media')
    expect(result.origin).toBe('https://space.hyper.media')
    expect(result.url.href).toBe('https://space.hyper.media/a/b/?q=hello%20world')
    expect(result.pathParts).toEqual(['a', 'b'])
  })

  it.each([
    ['space.example:8443', 'https://space.example:8443', '8443'],
    ['space.example:443', 'https://space.example', ''],
    ['space.example', 'https://space.example', ''],
  ])('uses only the forwarded port from %s', (authority, origin, port) => {
    const result = parseRequest(
      new Request('http://internal:3000/hm/api/config', {
        headers: {'X-Forwarded-Host': authority, 'X-Forwarded-Proto': 'https'},
      }),
    )
    expect(result.hostname).toBe('space.example')
    expect(result.origin).toBe(origin)
    expect(result.url.port).toBe(port)
  })

  it('removes an internal URL port when Host has no explicit port', () => {
    const result = parseRequest(new Request('http://internal:3000/', {headers: {Host: 'space.example'}}))
    expect(result.origin).toBe('http://space.example')
    expect(result.url.port).toBe('')
  })

  it('falls back to the request URL when authority headers are absent', () => {
    const result = parseRequest(
      new Request('https://space.example:8443/a%20b/?x=1&x=2', {
        headers: {'Accept-Language': 'es,en;q=0.8'},
      }),
    )
    expect(result.hostname).toBe('space.example')
    expect(result.origin).toBe('https://space.example:8443')
    expect(result.url.href).toBe('https://space.example:8443/a%20b/?x=1&x=2')
    expect(result.pathParts).toEqual(['a%20b'])
    expect(result.searchParams.getAll('x')).toEqual(['1', '2'])
    expect(result.prefersLanguages).toEqual(['es', 'en'])
  })

  it.each<Record<string, string>>([{Host: '[::1]:3000'}, {'X-Forwarded-Host': '[::1]:3000', Host: 'internal:4000'}])(
    'handles bracketed IPv6 authorities without duplicating ports: %j',
    (headers) => {
      const result = parseRequest(new Request('http://internal:4000/', {headers}))
      expect(result.hostname).toBe('[::1]')
      expect(result.origin).toBe('http://[::1]:3000')
      expect(result.url.href).toBe('http://[::1]:3000/')
      expect(result.pathParts).toEqual([])
      expect(result.prefersLanguages).toEqual([])
    },
  )
})
