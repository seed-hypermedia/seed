import {toast} from '@shm/ui/toast'

const IS_SENTRY_ENABLED =
  import.meta.env.PROD && !import.meta.env.VITE_DISABLE_SENTRY

export default async function appError(message: string, metadata?: any) {
  toast.error(message)

  if (IS_SENTRY_ENABLED) {
    const Sentry = await import('@sentry/electron')
    Sentry.captureException(metadata?.error || new Error(message))
  }
  console.error('📣 🚨', message, metadata)
}
