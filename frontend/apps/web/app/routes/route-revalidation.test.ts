import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {shouldRevalidateDocumentRoute, shouldRevalidateRootRoute} from './revalidation'

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

  it('does not revalidate when only the comment version changes on a comment permalink', () => {
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/doc/:comments/author/tsid'),
        nextUrl: url('/doc/:comments/author/tsid?v=comment-version-cid'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(false)
    expect(
      shouldRevalidateDocumentRoute({
        currentUrl: url('/doc/:comments/author/tsid?v=comment-version-cid'),
        nextUrl: url('/doc/:comments/author/tsid'),
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

// Publishing a reply navigates to `?panel=comments/…&reply=…` right after refetching every
// comment-related query. On a busy page that burst exceeds the proxy's in-flight limit, and any
// request the navigation itself makes can come back 429, which Remix turns into the root error
// page. These pin that such a navigation makes no request at all.
describe('navigation that only changes the query', () => {
  it('does not refetch the root loader when a panel or reply target changes', () => {
    expect(
      shouldRevalidateRootRoute({
        currentUrl: url('/projects?panel=comments/author/root'),
        nextUrl: url('/projects?panel=comments/author/root&reply=author/reply'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(false)
  })

  it('does not refetch the root loader when moving to another document', () => {
    expect(
      shouldRevalidateRootRoute({
        currentUrl: url('/projects'),
        nextUrl: url('/notes/one?v=version-1'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(false)
  })

  it('keeps the default for submissions and explicit revalidation', () => {
    expect(
      shouldRevalidateRootRoute({
        currentUrl: url('/projects'),
        nextUrl: url('/projects?panel=comments'),
        formMethod: 'POST',
        defaultShouldRevalidate: true,
      }),
    ).toBe(true)
    expect(
      shouldRevalidateRootRoute({
        currentUrl: url('/projects?panel=comments'),
        nextUrl: url('/projects?panel=comments'),
        defaultShouldRevalidate: true,
      }),
    ).toBe(true)
  })

  it('is wired into the root route', () => {
    const rootSource = readFileSync(join(import.meta.dirname, '..', 'root.tsx'), 'utf8')

    expect(rootSource).toMatch(/export function shouldRevalidate\b/)
    expect(rootSource).toContain('shouldRevalidateRootRoute')
  })

  it('does not fetch a route manifest before navigating', () => {
    const viteConfig = readFileSync(join(import.meta.dirname, '..', '..', 'vite.config.mts'), 'utf8')

    expect(viteConfig).toMatch(/v3_lazyRouteDiscovery:\s*false/)
    expect(viteConfig).not.toMatch(/v3_lazyRouteDiscovery:\s*true/)
  })
})
