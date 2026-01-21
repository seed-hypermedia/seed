import * as Sentry from '@sentry/electron'
import {toast} from '@shm/ui/toast'

export default function appError(
  message: string,
  metadata?: Record<string, unknown>,
) {
  toast.error(message)
  const error =
    metadata?.error instanceof Error ? metadata.error : new Error(message)
  Sentry.captureException(error, {extra: metadata})
  console.error('📣 🚨', message, metadata)
}
