/**
 * Normalizes a manually-entered key import path.
 */
export function normalizeImportKeyFilePath(filePath: string): string {
  return filePath.trim()
}

/**
 * Reports whether a path is absolute on Unix, Windows drive-letter, or UNC paths.
 */
function isAbsolutePath(filePath: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(filePath)
}

/**
 * Validates a manually-entered key import path before it is sent to the daemon.
 */
export function getImportKeyFilePathError(filePath: string): string | null {
  if (!filePath) {
    return 'Key file path is required'
  }

  if (!/\.hmkey\.json$/i.test(filePath)) {
    return 'Key file must end with .hmkey.json'
  }

  if (!isAbsolutePath(filePath)) {
    return 'Key file path must be absolute'
  }

  return null
}
