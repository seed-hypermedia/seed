export function hmIdPathToEntityQueryPath(path: string[] | null) {
  const filteredPath = path?.filter((term) => !!term)
  return filteredPath?.length ? `/${filteredPath.join('/')}` : ''
}

export function entityQueryPathToHmIdPath(
  path: string | null | undefined,
): string[] {
  if (!path) return []
  if (path === '/') return []
  return path.split('/').filter(Boolean)
}
