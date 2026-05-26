/** Slugify a string for use as a URL path segment. */
export function pathNameify(name: string) {
  return (
    name
      // Normalize to decompose diacritics (NFD form separates base letters and accents)
      .normalize('NFD')
      // Remove only the diacritical marks while keeping base letters
      .replace(/[\u0300-\u036f]/g, '')
      // Replace spaces with dashes
      .replace(/\s+/g, '-')
      // Replace long dashes with a short hyphen
      .replace(/—/g, '-')
      // Remove consecutive dashes
      .replace(/-+/g, '-')
      // Replace forward slashes with empty string (as in original)
      .replace(/\//g, '')
      // Only allow valid URL path characters, but include basic Latin letters with their diacritics removed
      .replace(/[^a-zA-Z0-9_-]/g, '')
      // Remove consecutive slashes
      .replace(/\/{2,}/g, '/')
      .toLowerCase()
      // Strip leading & trailing chars rejected by validatePath
      .replace(/^[-_.]+/, '')
      .replace(/[-_.]+$/, '')
  )
}
