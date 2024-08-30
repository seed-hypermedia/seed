export function hmIdPathToEntityQueryPath(path: string[] | null) {
  return path?.length ? `/${path.join('/')}` : ''
}

export function entityQueryPathToHmIdPath(path: string): string[] {
  if (path === '/') return []
  return path.split('/').filter(Boolean)
}
