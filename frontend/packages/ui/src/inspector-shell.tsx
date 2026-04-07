import {ReactNode} from 'react'

/** Provides the neutral inspector background and sticky toolbar layout. */
export function InspectorShell({
  title,
  toolbar,
  children,
  contentMaxWidth = 960,
}: {
  title: string
  toolbar?: ReactNode
  children: ReactNode
  contentMaxWidth?: number
}) {
  const maxWidthStyle = contentMaxWidth ? {maxWidth: contentMaxWidth} : undefined
  const maxWidthClass = contentMaxWidth ? '' : 'max-w-[calc(85ch+1em)]'

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-100">
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-100/95 backdrop-blur">
        <div className={`mx-auto w-full ${maxWidthClass}`} style={maxWidthStyle}>
          <div className="flex flex-col gap-3 px-4 py-3 md:px-0">
            <h1 className="font-mono text-base leading-tight font-semibold break-all text-zinc-700 md:text-lg">
              {title}
            </h1>
            {toolbar}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className={`mx-auto h-full w-full ${maxWidthClass}`} style={maxWidthStyle}>
          <div className="h-full px-4 py-4 md:px-0">{children}</div>
        </div>
      </div>
    </div>
  )
}
