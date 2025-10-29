import * as SeparatorPrimitive from '@radix-ui/react-separator'

import {cn} from './utils'

export function Separator({
  vertical = false,
  className,
}: {
  vertical?: boolean
  className?: string
}) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(
        // data-[orientation=vertical]:h-full - this was making vertical separator invisible
        'bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px',
        className,
      )}
    />
  )
}
