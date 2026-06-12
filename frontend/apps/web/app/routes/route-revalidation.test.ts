import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {shouldRevalidateDocumentRoute} from './revalidation'

function url(path: string) {
  return new URL(path, 'https://example.com')
}

describe('document route revalidation', () => {
  it('revalidates when only the requested document version changes', () => {
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/doc?panel=activity/versions'),
        nextUrl: url('/doc?v=version-1&panel=activity/versions'),
        defaultShouldRevalidate: false,
      }),
    ).toBe(true)
  })

  it('does not revalidate for panel-only changes', () => {
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/doc?v=version-1'),
        nextUrl: url('/doc?v=version-1&panel=activity/versions'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(false)
  })

  it('revalidates when moving from an activity URL to a versioned document URL', () => {
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/doc/:activity/versions'),
        nextUrl: url('/doc?v=version-1'),
        defaultShouldRevalidate: false,
      }),
    ).toBe(true)
  })

  it('uses the same version revalidation on the home document route', () => {
    const indexRouteSource = readFileSync(join(import.meta.dirname, '_index.tsx'), 'utf8')

    expect(indexRouteSource).toContain('shouldRevalidateDocumentRoute')
  })
})
