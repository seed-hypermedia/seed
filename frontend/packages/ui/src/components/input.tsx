import * as React from 'react'

import {cva, VariantProps} from 'class-variance-authority'
import {cn} from '../utils'

export type InputProps = React.ComponentProps<'input'> & {
  onChangeText?: (value: string) => void
} & VariantProps<typeof inputVariants>

const inputVariants = cva(
  'font-sans border-input text-foreground flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base transition-[box-shadow] outline-none file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 md:text-sm aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default:
          'shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        unstyled:
          'focus-visible:border-transparent focus-visible:ring-[3px] focus-visible:ring-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export function Input({
  className,
  type,
  onChangeText,
  onChange,
  variant = 'default',
  ...props
}: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({variant}), className)}
      onChange={(e) => {
        if (onChangeText) {
          onChangeText(e.target.value)
        } else {
          onChange?.(e)
        }
      }}
      {...props}
    />
  )
}
