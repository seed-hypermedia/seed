import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {FallbackProps, useErrorBoundary} from 'react-error-boundary'
import {ErrorBar} from './error-bar'

export function AppErrorPage({error}: FallbackProps) {
  return (
    <div className={windowContainerStyles}>
      <ErrorBar />
      <AppErrorContent message={error.message} />
    </div>
  )
}

export function RootAppError({error}: FallbackProps) {
  return <AppErrorContent message={error.message} />
}

export function AppErrorContent({message}: {message: string}) {
  const {resetBoundary} = useErrorBoundary()

  return (
    <div className={panelContainerStyles}>
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div
          role="alertdialog"
          className="m-8 flex w-full max-w-2xl flex-1 flex-none flex-col shadow-lg"
        >
          <div className="rounded-t bg-red-500 px-4 py-2">
            <h2 className="text-xl font-bold text-white">
              Something went wrong
            </h2>
          </div>
          <div className="max-h-50 gap-4 rounded-b border border-t-0 border-red-400 bg-red-100 px-4 py-3">
            <ScrollArea>
              <pre className="p-4 text-sm break-all whitespace-pre-wrap text-red-700">
                {message}
              </pre>
            </ScrollArea>
            <Button variant="destructive" onClick={resetBoundary}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
