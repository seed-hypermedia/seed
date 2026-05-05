import {describe, expect, it} from 'vitest'
import {seedBrowserTracePropagationTargets} from '../sentry-tracing'

function matchesTracePropagationTarget(url: string) {
  return seedBrowserTracePropagationTargets.some((target) => {
    if (typeof target === 'string') return url.includes(target)
    return target.test(url)
  })
}

describe('seedBrowserTracePropagationTargets', () => {
  it('matches public hyper.media web origins', () => {
    expect(matchesTracePropagationTarget('https://hyper.media')).toBe(true)
    expect(matchesTracePropagationTarget('https://hyper.media/hm/download')).toBe(true)
    expect(matchesTracePropagationTarget('https://seed.hyper.media/resources/self-host-seed')).toBe(true)
    expect(matchesTracePropagationTarget('https://mysite.hyper.media/hm/example')).toBe(true)
  })

  it('does not match service or loopback origins that do not consume browser trace headers', () => {
    expect(matchesTracePropagationTarget('https://host.seed.hyper.media/api/info')).toBe(false)
    expect(matchesTracePropagationTarget('https://host-dev.seed.hyper.media/api/info')).toBe(false)
    expect(matchesTracePropagationTarget('https://ln.seed.hyper.media')).toBe(false)
    expect(matchesTracePropagationTarget('https://notify.seed.hyper.media')).toBe(false)
    expect(matchesTracePropagationTarget('http://localhost:56001/ipfs/file-upload')).toBe(false)
    expect(matchesTracePropagationTarget('http://127.0.0.1:56001/ipfs/file-upload')).toBe(false)
  })

  it('does not match lookalike domains', () => {
    expect(matchesTracePropagationTarget('https://hyper.media.evil.example')).toBe(false)
    expect(matchesTracePropagationTarget('https://seed.hyper.media.evil.example')).toBe(false)
  })
})
