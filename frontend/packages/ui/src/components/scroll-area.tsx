import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as React from 'react'
import {forwardRef} from 'react'
import {cn} from '../utils'

function _ScrollArea(
  {
    className,
    children,
    onScroll,
    ...props
  }: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
    onScroll?: (e: React.UIEvent<HTMLElement>) => void
  },
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const scrollId = (props as any)['data-scroll-id']
  if (scrollId === 'main-document-scroll') {
    console.log('Main document ScrollArea rendering, onScroll:', !!onScroll)
  }

  const handleViewportRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !onScroll) return

      // Wait a tick for Radix to set up its internal structure
      setTimeout(() => {
        // Check all possible scroll containers
        const viewport = node
        const firstChild = node.children[0] as HTMLElement
        const handleScroll = (e: Event) => {
          onScroll(e as any)
        }

        // Try both the viewport and its first child
        if (viewport) {
          viewport.addEventListener('scroll', handleScroll, {passive: true})
        }

        if (firstChild) {
          firstChild.addEventListener('scroll', handleScroll, {passive: true})
        }
      }, 100)
    },
    [onScroll],
  )

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative h-full overflow-hidden', className)}
      ref={ref}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={handleViewportRef}
        data-slot="scroll-area-viewport"
        className="focus-visible:ring-ring/50 relative size-full h-full flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

const ScrollArea = forwardRef(_ScrollArea)

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export {ScrollArea, ScrollBar}
