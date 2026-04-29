import * as Sentry from '@sentry/electron/renderer'
import {toast} from '@shm/ui/toast'

export default function appError(message: string, metadata?: Record<string, unknown>) {
  toast.error(message)
  const error = metadata?.error instanceof Error ? metadata.error : new Error(message)
  Sentry.withScope((scope) => {
    if (metadata) {
      scope.setExtras(metadata)
      const feature = typeof metadata.feature === 'string' ? metadata.feature : undefined
      const operation = typeof metadata.operation === 'string' ? metadata.operation : undefined
      if (feature) scope.setTag('feature', feature)
      if (operation) scope.setTag('operation', operation)
    }
    Sentry.captureException(error)
  })
  console.error('📣 🚨', message, metadata)
}
