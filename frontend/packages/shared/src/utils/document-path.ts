export function validatePath(path: string): {error: string} | null {
  if (path === '') return null // this is for site home documents
  if (path.startsWith('/')) {
    path = path.slice(1)
    // Return error for reserved paths
    if (['assets', 'favicon.ico', 'robots.txt', 'hm', 'api'].includes(path)) {
      return {
        error: `This path name is reserved and can't be used: ${path}`,
      }
    }

    // Return error for paths starting with special characters
    if (path.startsWith('-') || path.startsWith('.') || path.startsWith('_')) {
      return {
        error: `Path can't start with special characters "-", "." or "_": ${path}`,
      }
    }

    // Return null by default (path is valid)
    return null
  } else {
    return {
      error: `wrong path format (should start with '/')`,
    }
  }
}
