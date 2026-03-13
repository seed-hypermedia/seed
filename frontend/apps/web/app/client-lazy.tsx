import {lazy, useEffect, useState} from 'react'
import {WebCommentingProps} from './commenting'
import {isPerfEnabled, markEditorLoadStart, markPanelOpenStart} from './web-perf-marks'

function clientLazy<ComponentProps extends {}>(doImport: () => Promise<{default: React.FC<ComponentProps>}>) {
  const ClientComponent = lazy(doImport)
  function ClientAwokenComponent(props: ComponentProps) {
    const [isClientAwake, setIsClientAwake] = useState(false)
    useEffect(() => {
      setIsClientAwake(true)
    }, [])
    // @ts-expect-error
    return isClientAwake ? <ClientComponent {...props} /> : null
  }
  return ClientAwokenComponent
}

export const WebCommenting = clientLazy<WebCommentingProps>(async () => {
  if (isPerfEnabled()) {
    markEditorLoadStart()
    markPanelOpenStart()
  }
  const mod = await import('./commenting')
  return {default: mod.default}
})

/** Preload the commenting chunk on hover to reduce editor load time */
export function preloadCommenting(): void {
  import('./commenting').catch(() => {})
}

export const AccountFooterActionsLazy = clientLazy<{}>(async () => ({
  default: (await import('./auth')).AccountFooterActions,
}))

// Children of this component will only be rendered on the client side.
export function ClientOnly({children}: {children: React.ReactNode}) {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) return null

  return <>{children}</>
}
