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
  centered = false,
  contentMaxWidth,
}: {
  title?: string
  headerRight?: ReactNode
  children: ReactNode
  centered?: boolean
  contentMaxWidth?: number
}) {
  const hasHeader = title || headerRight
  const maxWidthStyle = contentMaxWidth
    ? {maxWidth: contentMaxWidth}
    : undefined
  const maxWidthClass = contentMaxWidth ? '' : 'max-w-[calc(85ch+1em)]'

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      {hasHeader && (
        <div className="shrink-0">
          <div
            className={`flex items-center gap-4 px-8 py-4 ${
              centered ? `mx-auto w-full ${maxWidthClass}` : 'px-6'
            }`}
            style={centered ? maxWidthStyle : undefined}
          >
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
        {centered ? (
          <div
            className={`mx-auto w-full px-4 ${maxWidthClass}`}
            style={maxWidthStyle}
          >
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
