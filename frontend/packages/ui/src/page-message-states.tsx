import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {ArrowRight} from 'lucide-react'
import {ReactNode} from 'react'
import {Button} from './button'
import {panelContainerStyles} from './container'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {cn} from './utils'

// Re-export PageLayout from its own file for backwards compatibility
export {PageLayout} from './page-layout'

/**
 * Generic message box for page-level states (loading, errors, not found, etc.)
 * Used by document, feed, and directory pages.
 */
export function PageMessageBox({
  title,
  message,
  children,
  spinner,
}: {
  title: string
  message: string
  children?: ReactNode
  spinner?: boolean
}) {
  return (
    <div className={cn(panelContainerStyles)}>
      <div className="mx-auto px-8 py-10">
        <div className="border-border bg-background flex w-full max-w-lg flex-none flex-col gap-4 rounded-lg border p-6 shadow-lg dark:bg-black">
          {spinner ? (
            <div className="flex items-center justify-start">
              <Spinner className="fill-link size-6" />
            </div>
          ) : null}
          <SizableText size="2xl" weight="bold">
            {title}
          </SizableText>

          <SizableText asChild className="text-muted-foreground">
            <p>{message}</p>
          </SizableText>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Shown when a document has been redirected to a new location.
 */
export function PageRedirected({
  redirectTarget,
  onNavigate,
}: {
  docId?: UnpackedHypermediaId
  redirectTarget: UnpackedHypermediaId
  onNavigate: (target: UnpackedHypermediaId) => void
}) {
  return (
    <PageMessageBox
      title="Redirected"
      message="This document has been redirected to a new location."
    >
      <Button
        onClick={() => {
          onNavigate(redirectTarget)
        }}
      >
        <ArrowRight className="size-4" />
        Go to New Location
      </Button>
    </PageMessageBox>
  )
}

/**
 * Shown when discovering/loading a document from the network.
 */
export function PageDiscovery() {
  return (
    <PageMessageBox
      title="Looking for this document..."
      spinner
      message="This document is not on your node yet. Now finding a peer who can provide it."
    />
  )
}

/**
 * Shown when a document is not found.
 */
export function PageNotFound() {
  return (
    <PageMessageBox
      title="Document Not Found"
      message="This document could not be found on the network."
    />
  )
}
