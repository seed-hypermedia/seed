import {FallbackProps, getErrorMessage, useErrorBoundary} from 'react-error-boundary'

export function ErrorFallback({error}: FallbackProps) {
  const {resetBoundary} = useErrorBoundary()
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-lg border border-red-300 bg-red-50 p-6">
        <h2 className="mb-2 text-lg font-semibold text-red-800">
          Something went wrong
        </h2>
        <pre className="mb-4 whitespace-pre-wrap break-all text-sm text-red-600">
          {getErrorMessage(error)}
        </pre>
        <button
          onClick={resetBoundary}
          className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
