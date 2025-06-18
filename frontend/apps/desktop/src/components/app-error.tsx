import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {FallbackProps} from 'react-error-boundary'
import {ErrorBar} from './error-bar'

export function AppErrorPage({error, resetErrorBoundary}: FallbackProps) {
  return (
    <div className={windowContainerStyles}>
      <ErrorBar />
      <AppErrorContent
        message={error.message}
        resetErrorBoundary={resetErrorBoundary}
      />
    </div>
  )
}

export function RootAppError({error, resetErrorBoundary}: FallbackProps) {
  return (
    <AppErrorContent
      message={error.message}
      resetErrorBoundary={resetErrorBoundary}
    />
  )
}

export function AppErrorContent({
  message,
  resetErrorBoundary,
}: {
  message: string
  resetErrorBoundary?: () => void
}) {
  return (
    <div className={panelContainerStyles}>
      <div className="flex items-start justify-center flex-1 px-4 py-12">
        <div
          role="alertdialog"
          className="flex flex-col flex-1 w-full max-w-2xl flex-none shadow-lg m-8"
        >
          <div className="bg-red-500 rounded-t px-4 py-2">
            <h2 className="text-xl text-white font-bold">
              Something went wrong
            </h2>
          </div>
          <div className="border border-t-0 border-red-400 rounded-b bg-red-100 px-4 py-3  max-h-50 overflow-y-auto gap-4">
            <ScrollArea>
              <pre className="text-red-700 text-sm whitespace-pre-wrap break-all p-4">
                {message}
              </pre>
            </ScrollArea>
            {resetErrorBoundary && (
              <Button variant="destructive" onClick={resetErrorBoundary}>
                Try again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
