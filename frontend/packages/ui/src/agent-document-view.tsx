import {isMountableAgentServerUrl} from '@seed-hypermedia/agents-protocol'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import type {DocumentRoute} from '@shm/shared/routes'
import {createContext, lazy, Suspense, useContext, useEffect, useState, type ComponentType, type ReactNode} from 'react'
import {Spinner} from './spinner'

/** Host-independent props for an agent view inside a document. */
export type AgentDocumentViewProps = {
  document: HMDocument
  route: DocumentRoute
  /** Matches the surrounding document column for the agent home. */
  contentMaxWidth?: number
  /** Renders document chrome with the server-confirmed registration state instead of an agent pane. */
  children?: (hasAgent: boolean) => ReactNode
}
const DefaultAgentDocumentView = lazy(() => import('./agents/document'))
/** Web supplies a client-only view that registers its signing and editor adapter. */
export const AgentDocumentViewContext = createContext<ComponentType<AgentDocumentViewProps>>(DefaultAgentDocumentView)

/** Keeps agent modules lazy while the ordinary document remains server-renderable. */
export function AgentDocumentView(props: AgentDocumentViewProps) {
  const View = useContext(AgentDocumentViewContext)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const fallback = props.children ? (
    props.children(false)
  ) : (
    <div className="flex justify-center p-8">
      <Spinner />
    </div>
  )
  if (
    props.children &&
    ((props.document.metadata.type !== undefined && props.document.metadata.type !== 'hm://hyper.media/agent') ||
      !isMountableAgentServerUrl(props.document.metadata.agentServerUrl || ''))
  )
    return fallback
  // Mount the lazy boundary after hydration so identity updates cannot interrupt its hydration.
  if (!mounted) return fallback
  return (
    <Suspense fallback={fallback}>
      <View {...props} />
    </Suspense>
  )
}
