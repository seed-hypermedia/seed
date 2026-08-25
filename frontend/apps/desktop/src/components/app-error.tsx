import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {toast} from '@shm/ui/toast'
import {Check, Copy, RefreshCw, TriangleAlert} from 'lucide-react'
import {useState} from 'react'
import {FallbackProps, getErrorMessage} from 'react-error-boundary'
import {ErrorBar} from './error-bar'

export function AppErrorPage({error}: FallbackProps) {
  return (
    <div className={windowContainerStyles}>
      <ErrorBar />
      <AppErrorContent message={getErrorMessage(error) ?? 'Unknown error'} />
    </div>
  )
}

export function RootAppError({error}: FallbackProps) {
  return <AppErrorContent message={getErrorMessage(error) ?? 'Unknown error'} />
}

export function AppErrorContent({
  message,
  details,
  exitCode,
  signal,
  title = 'Something went wrong',
  description = 'Try again or copy the details below when asking for help.',
  eyebrow = 'Application error',
}: {
  message: string
  details?: string
  exitCode?: number | null
  signal?: string | null
  title?: string
  description?: string
  eyebrow?: string
}) {
  const [copied, setCopied] = useState(false)
  const diagnostics = [
    message,
    exitCode != null ? `Exit code: ${exitCode}` : null,
    signal ? `Signal: ${signal}` : null,
    details,
  ]
    .filter(Boolean)
    .join('\n\n')

  const copyDiagnostics = async () => {
    try {
      await copyTextToClipboard(diagnostics)
      setCopied(true)
      toast.success('Diagnostics copied to clipboard')
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('Could not copy diagnostics')
    }
  }

  return (
    <div className={panelContainerStyles}>
      <div className="flex flex-1 items-start justify-center overflow-auto px-4 py-16 sm:px-8">
        <div
          role="alertdialog"
          className="border-border bg-background m-4 flex w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-sm"
        >
          <div className="border-border flex items-start gap-4 border-b px-6 py-5">
            <div className="bg-destructive/10 text-destructive flex size-10 shrink-0 items-center justify-center rounded-full">
              <TriangleAlert className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-widest uppercase">{eyebrow}</p>
              <h2 className="text-foreground text-xl font-semibold">{title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{description}</p>
            </div>
          </div>
          <div className="flex flex-col gap-5 px-6 py-5">
            <p className="text-foreground text-sm">{message}</p>
            {details ? (
              <div className="border-border bg-muted/40 overflow-hidden rounded-lg border">
                <div className="border-border text-muted-foreground flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
                  <span>Recent daemon output</span>
                  <button
                    type="button"
                    onClick={copyDiagnostics}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? 'Copied' : 'Copy diagnostics'}
                  </button>
                </div>
                <ScrollArea className="max-h-64">
                  <pre className="text-muted-foreground p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
                    {details}
                  </pre>
                </ScrollArea>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
