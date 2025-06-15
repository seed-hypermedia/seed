import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'

import {cva, VariantProps} from 'class-variance-authority'
import {cn} from '../utils'

const labelVariants = cva(
  'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'text-sm',
        sm: 'text-xs',
        lg: 'text-lg',
      },
    },
  },
)

function Label({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(labelVariants({size}), className)}
      {...props}
    />
  )
}

export {Label}
