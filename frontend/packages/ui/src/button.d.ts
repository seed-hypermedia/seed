import {type VariantProps} from 'class-variance-authority'
import * as React from 'react'
export declare function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }): import('react/jsx-runtime').JSX.Element
export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }
export declare const buttonVariants: (
  props?:
    | ({
        variant?:
          | 'link'
          | 'default'
          | 'destructive'
          | 'outline'
          | 'secondary'
          | 'ghost'
          | 'brand'
          | 'brand-12'
          | 'blue'
          | 'green'
          | 'orange'
          | 'inverse'
          | null
          | undefined
        size?:
          | 'icon'
          | 'default'
          | 'xs'
          | 'sm'
          | 'lg'
          | 'iconSm'
          | null
          | undefined
      } & import('class-variance-authority/types').ClassProp)
    | undefined,
) => string
