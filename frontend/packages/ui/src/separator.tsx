import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as React from 'react'

import {cn} from './utils'

export function Separator({
  className,
  vertical = false,
  decorative = true,
  ...props
}: Omit<React.ComponentProps<typeof SeparatorPrimitive.Root>, 'orientation'> & {
  vertical?: boolean
}) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(
        'bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  )
}
