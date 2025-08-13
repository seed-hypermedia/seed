import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'
import {cn} from './utils'

export function Tooltip({
  content,
  side = 'top',
  children,
  delay = 200,
  asChild = false,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  delay?: number
  content: string
  side?: React.ComponentProps<typeof TooltipContent>['side']
  asChild?: boolean
}) {
  if (!content) return children
  return (
    <TooltipPrimitive.Root data-slot="tooltip" {...props} delayDuration={delay}>
      <TooltipTrigger asChild>
        {asChild ? children : <span>{children}</span>}
      </TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TooltipPrimitive.Root>
  )
}

// ================================================

export function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md bg-black px-3 py-1.5 text-xs text-balance text-white dark:bg-white dark:text-black',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-black fill-black dark:bg-white dark:fill-white" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}
