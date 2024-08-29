export function hmIdPathToEntityQueryPath(path: string[] | null) {
  return path?.length ? `/${path.join('/')}` : ''
}
