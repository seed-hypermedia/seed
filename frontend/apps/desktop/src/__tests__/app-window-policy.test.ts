import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {appContentSecurityPolicy, isAllowedFrameURL, type AppWindowPolicy} from '../app-window-policy'

const policy: AppWindowPolicy = {
  appOrigin: 'http://localhost:17654',
  daemonOrigin: 'http://localhost:56001',
  fileOrigin: 'http://localhost:56001',
  connectOrigins: ['http://localhost:56004', 'http://localhost:3050'],
  development: false,
}

describe('frame URL boundary', () => {
  it.each([
    'https://youtube.com/embed/video',
    'https://www.youtube.com/embed/video',
    'https://www.youtube-nocookie.com/embed/video',
    'https://platform.twitter.com/embed',
    'http://localhost:56001/ipfs/cid',
    'http://localhost:17654/app',
  ])('allows supported frame %s', (url) => {
    expect(isAllowedFrameURL(url, policy)).toBe(true)
  })

  it.each([
    'https://evil.example/youtube.com',
    'https://youtube.com.evil.example/',
    'https://notyoutube.com/',
    'https://youtube.com@evil.example/',
    'https://evil.example/#twitter.com',
    'https://evil.example/?host=instagram.com',
    'http://localhost:9999/',
    'http://127.0.0.1:56001/',
    'file:///youtube.com',
    'javascript:youtube.com',
    'data:text/html,youtube.com',
    'blob:https://youtube.com/id',
    'https://com/',
    'not a URL',
  ])('rejects unsupported frame %s', (url) => {
    expect(isAllowedFrameURL(url, policy)).toBe(false)
  })
})

it('allows only the configured IPFS gateway origin', () => {
  const gatewayPolicy = {...policy, fileOrigin: 'https://assets.example'}
  expect(isAllowedFrameURL('https://assets.example/ipfs/cid', gatewayPolicy)).toBe(true)
  expect(isAllowedFrameURL('https://assets.example.evil.test/ipfs/cid', gatewayPolicy)).toBe(false)
  expect(appContentSecurityPolicy(gatewayPolicy)).toContain(
    "frame-src 'self' http://localhost:56001 https://assets.example",
  )
})

it('limits script execution while preserving configured local services', () => {
  const csp = appContentSecurityPolicy(policy)
  expect(csp).toContain("script-src 'self' https://platform.twitter.com/widgets.js")
  expect(csp.split('; ').find((directive) => directive.startsWith('script-src'))).not.toContain('unsafe-inline')
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).toContain(
    "connect-src 'self' http://localhost:* http://127.0.0.1:* https: ws://localhost:* ws://127.0.0.1:* wss:",
  )
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toContain(' ws: ')
  expect(appContentSecurityPolicy({...policy, development: true})).toContain('ws://localhost:*')
})

it('pins the exact loading bootstrap without permitting other inline scripts', () => {
  const html = readFileSync(path.resolve(__dirname, '../../loading.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
  const hash = createHash('sha256').update(script).digest('base64')
  expect(html).toContain(`script-src 'self' 'sha256-${hash}'`)
  expect(html).not.toContain("script-src 'self' 'unsafe-inline'")
})
