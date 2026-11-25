/** Keep document HTML in the SSR loader data, but not in Remix's browser payload. */
export function omitSSRContentHTML(serverHandoffString: string): string {
  const handoff = JSON.parse(serverHandoffString)
  let changed = false
  for (const payload of Object.values<{json?: {ssrContentHTML?: string | null}} | null>(
    handoff.state?.loaderData ?? {},
  )) {
    if (typeof payload?.json?.ssrContentHTML === 'string') {
      delete payload.json.ssrContentHTML
      changed = true
    }
  }
  if (!changed) return serverHandoffString

  // Remix inserts this JSON directly into a script; preserve its HTML escaping.
  return JSON.stringify(handoff).replace(
    /[&<>\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/** Restore the omitted HTML before Remix reads or caches the initial loader data. */
export function restoreSSRContentHTML(
  loaderData: Record<string, {json?: {document?: unknown; ssrContentHTML?: string | null}} | null>,
  document: Document,
) {
  const contentHTML = document.querySelector('.ssr-content-placeholder')?.outerHTML
  if (!contentHTML) return

  for (const payload of Object.values(loaderData)) {
    if (payload?.json?.document && !('ssrContentHTML' in payload.json)) {
      payload.json.ssrContentHTML = contentHTML
    }
  }
}
