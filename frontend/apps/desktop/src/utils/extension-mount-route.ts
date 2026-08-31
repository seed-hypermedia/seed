import {resolveExtensionMount} from '@seed-hypermedia/client/extensions'

/**
 * Route keys that are views of the same document (main page, directory,
 * activity, comments, collaborators, attributes). The web loader strips the
 * matching view terms before mount resolution (apps/web/app/extension-route.ts),
 * so a mount shadows every view of the document on both hosts
 * (docs/extensions/design.md §3.3). `site-profile` and `all-documents` are
 * site-level routes, not views of the mounted document.
 */
export const EXTENSION_SHADOWED_ROUTE_KEYS: ReadonlySet<string> = new Set([
  'document',
  'directory',
  'activity',
  'comments',
  'collaborators',
  'metadata',
])

/**
 * Resolve the extension mount that shadows a desktop resource route, or null.
 *
 * Draft routes are never shadowed: on desktop the unified editor lives on the
 * `document` route, both for new drafts (placeholder `-<draftId>` segment) and
 * for existing drafts editing the path, and those must still reach the editor.
 */
export function resolveDesktopExtensionMount({
  routeKey,
  isDraftRoute,
  homeMetadata,
  path,
}: {
  routeKey: string
  isDraftRoute: boolean
  homeMetadata: unknown
  path: string[] | null | undefined
}) {
  if (isDraftRoute || !EXTENSION_SHADOWED_ROUTE_KEYS.has(routeKey)) return null
  return resolveExtensionMount(homeMetadata, path)
}
