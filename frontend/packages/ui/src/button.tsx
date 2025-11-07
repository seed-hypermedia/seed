import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'

import {cn} from './utils'

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({variant, size, className}))}
      {...props}
    />
  )
}

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive:
          'bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive dark:hover:bg-destructive/90',
        outline:
          'border bg-transparent shadow-xs hover:bg-background hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost:
          'active:bg-black/5 text-foreground dark:active:bg-white/10 hover:text-foreground hover:bg-black/5 dark:hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
        brand: 'bg-brand text-white shadow-xs hover:bg-brand-4 active:brand-3',
        'brand-12':
          'bg-brand-12 shadow-xs hover:bg-brand-11 active:bg-brand-10',
        blue: 'bg-blue-700 text-white shadow-xs hover:bg-blue-800',
        green: 'bg-green-700 text-white shadow-xs hover:bg-green-800',
        orange: 'bg-orange-700 text-white shadow-xs hover:bg-orange-800',
        inverse:
          'bg-black text-white shadow-xs hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90',
      },
      size: {
        xs: 'h-6 rounded-md gap-1.5 px-2 has-[>svg]:px-1.5 text-xs',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 text-sm',
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'h-6 min-w-6 rounded-md has-[>svg]:px-2',
        iconSm: 'h-4 min-w-4 rounded-md has-[>svg]:px-1',
      },
    },

    defaultVariants: {
      variant: 'ghost',
      size: 'default',
    },
  },
)
