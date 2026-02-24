import {ReactNode} from 'react'
import {Text} from './text'

/**
 * Consistent layout wrapper for full-page content (activity, discussions, directory, etc.)
 * Parent component (ResourcePage) handles scrolling - this just provides layout structure.
 */
export function PageLayout({
  title,
  headerRight,
  children,
  contentMaxWidth,
}: {
  title?: string
  headerRight?: ReactNode
  children: ReactNode
  contentMaxWidth?: number
}) {
  const hasHeader = title || headerRight
  const maxWidthStyle = contentMaxWidth ? {maxWidth: contentMaxWidth} : undefined
  const maxWidthClass = contentMaxWidth ? '' : 'max-w-[calc(85ch+1em)]'

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      {hasHeader && (
        <div className="shrink-0">
          <div className={`mx-auto flex w-full items-center gap-4 ${maxWidthClass}`} style={maxWidthStyle}>
            {title && (
              <Text weight="bold" size="2xl" className="flex-1">
                {title}
              </Text>
            )}
            {headerRight}
          </div>
        </div>
      )}
      {/* Content - no scroll, parent handles it */}
      <div className="flex-1">
        <div className={`mx-auto w-full ${maxWidthClass}`} style={maxWidthStyle}>
          {children}
        </div>
      </div>
    </div>
  )
}
