import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'

import {cn} from '../utils'

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer data-[state=checked]:bg-primary focus-visible:border-ring focus-visible:ring-ring/50 border-border border-border inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border shadow-xs transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-black/5 dark:data-[state=unchecked]:bg-white/10',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'bg-background dark:data-[state=unchecked]:bg-background dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive.Root>
