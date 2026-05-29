/** Slugify a string for use as a URL path segment. */
export function pathNameify(name: string) {
  return (
    name
      // Normalize to decompose diacritics (NFD form separates base letters and accents)
      .normalize('NFD')
      // Remove only the diacritical marks while keeping base letters
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Normalize en/em dashes to a short hyphen
      .replace(/[–—]/g, '-')
      // Any char outside the slug alphabet (spaces, `+`, `&`, `/`, `.`, punctuation,
      // etc.) collapses to a single dash so separators don't get dropped or doubled
      .replace(/[^a-z0-9_-]+/g, '-')
      // Collapse consecutive dashes left behind by the previous step
      .replace(/-+/g, '-')
      // Strip leading & trailing chars rejected by validatePath
      .replace(/^[-_.]+/, '')
      .replace(/[-_.]+$/, '')
  )
}
