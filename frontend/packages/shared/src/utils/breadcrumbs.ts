export function getParentPaths(path?: string[] | null): string[][] {
  if (!path) return [[]]
  let walkParentPaths: string[] = []
  return [
    [],
    ...path.map((term) => {
      walkParentPaths = [...walkParentPaths, term]
      return walkParentPaths
    }),
  ]
}
