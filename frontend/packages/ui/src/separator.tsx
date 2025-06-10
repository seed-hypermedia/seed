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
        'bg-gray-300 shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
    />
  )
}
