import {cn} from '../utils'
import type {ReactNode} from 'react'
import {PanelContainer} from '../container'

/**
 * The shell of an agent page. On its own page it is a desktop panel (background, rounded border).
 * Embedded under a document's tabs it is a plain column that fills the space the page gives it:
 * the document already draws the chrome, so a second border and background would double up.
 */
export function AgentPane({
  embedded,
  className,
  children,
}: {
  embedded: boolean
  className?: string
  children: ReactNode
}) {
  if (embedded) return <div className={cn('flex h-full w-full flex-col overflow-hidden', className)}>{children}</div>
  return <PanelContainer className={className}>{children}</PanelContainer>
}
