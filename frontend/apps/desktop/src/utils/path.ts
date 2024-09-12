export function pathNameify(name: string) {
  return (
    name
      // Remove spaces
      .replace(/\s+/g, '-')
      // Remove consecutive dashes
      .replace(/-+/g, '-')
      // Replace forward slashes with hyphens
      .replace(/\//g, '')
      // Only allow valid URL path characters
      .replace(/[^a-zA-Z0-9_-]/g, '')
      // Remove consecutive slashes (no longer needed, but kept for safety)
      .replace(/\/{2,}/g, '/')
      .toLowerCase()
  )
}
