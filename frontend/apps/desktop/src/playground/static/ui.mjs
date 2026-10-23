/** Escape data before rendering it as HTML. */
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  )
/** Render the consistent pictogram for a world entity. */
export function entityIcon(type) {
  const body =
    type === 'key'
      ? '<circle cx="9" cy="9" r="5"/><path d="m12.5 12.5 8 8m-3-3 3-3m-6 0 3-3"/>'
      : type === 'resource'
        ? '<path d="M3 7h7l2 3h9v11H3z"/><path d="M3 7V4h7l2 3h8v3"/>'
        : type === 'grant'
          ? '<path d="m3 5 4-3h10l4 3v14l-4 3H7l-4-3z"/><path d="M8 8h8M8 12h8M8 16h5"/>'
          : type === 'revocation'
            ? '<path d="m5 5 14 14M19 5 5 19"/><circle cx="12" cy="12" r="10"/>'
            : '<path d="M5 2h10l5 5v15H5zM14 2v6h6M8 12h9M8 16h7"/>'
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}
