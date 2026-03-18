import {NoOutputGeneratedError} from 'ai'

/**
 * Resolves the most useful error to surface when chat streaming fails.
 */
export function resolveChatStreamError(error: unknown, streamError?: unknown): Error {
  const preferredError =
    NoOutputGeneratedError.isInstance(error) && streamError != null
      ? streamError
      : NoOutputGeneratedError.isInstance(error) && error.cause != null
      ? error.cause
      : error

  if (preferredError instanceof Error) {
    return preferredError
  }

  if (typeof preferredError === 'string' && preferredError.trim()) {
    return new Error(preferredError)
  }

  if (
    preferredError &&
    typeof preferredError === 'object' &&
    'message' in preferredError &&
    typeof preferredError.message === 'string' &&
    preferredError.message.trim()
  ) {
    return new Error(preferredError.message)
  }

  return new Error('Chat request failed.')
}
