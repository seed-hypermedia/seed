import * as Sentry from '@sentry/electron'
import {toast} from '@shm/ui/toast'

export default function appError(message: string, metadata?: any) {
  toast.error(message)

  if (!import.meta.env.VITE_DISABLE_SENTRY) {
    Sentry.captureException(metadata?.error || new Error(message, metadata))
  }
  console.error('📣 🚨', message, metadata)
}
