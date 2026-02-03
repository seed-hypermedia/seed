import {ScrollArea} from '@radix-ui/react-scroll-area'
import {ReactNode} from 'react'
import {Text} from './text'

/**
 * Consistent layout wrapper for full-page content (activity, discussions, directory, etc.)
 * Ensures proper scroll behavior with fixed header and scrollable content area.
 */
export function PageLayout({
  title,
  headerRight,
  children,
  centered = false,
  contentMaxWidth,
  scrollRef,
}: {
  title?: string
  headerRight?: ReactNode
  children: ReactNode
  centered?: boolean
  contentMaxWidth?: number
  scrollRef?: React.Ref<HTMLDivElement>
}) {
  const hasHeader = title || headerRight
  const maxWidthStyle = contentMaxWidth
    ? {maxWidth: contentMaxWidth}
    : undefined
  const maxWidthClass = contentMaxWidth ? '' : 'max-w-[calc(85ch+1em)]'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Fixed header */}
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
      <ScrollArea
        className="min-h-0 flex-1 overflow-auto pb-16"
        ref={scrollRef}
      >
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
      </ScrollArea>
    </div>
  )
}
