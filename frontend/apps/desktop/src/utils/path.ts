export function pathNameify(name: string) {
  return (
    name
      // Remove spaces
      .replace(/\s+/g, '-')
      // Remove consecutive dashes
      .replace(/-+/g, '-')
      // Only allow valid URL path characters
      .replace(/[^a-zA-Z0-9/_-]/g, '')
      // Remove consecutive slashes
      .replace(/\/{2,}/g, '/')
      .toLowerCase()
  )
}
