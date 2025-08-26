import {type VariantProps} from 'class-variance-authority'
import * as React from 'react'
declare const textVariants: (
  props?:
    | ({
        size?:
          | 'xs'
          | 'sm'
          | 'lg'
          | 'md'
          | 'xl'
          | '2xl'
          | '3xl'
          | '4xl'
          | '5xl'
          | null
          | undefined
        color?:
          | 'default'
          | 'destructive'
          | 'brand'
          | 'brand-12'
          | 'warning'
          | 'success'
          | 'muted'
          | null
          | undefined
        weight?:
          | 'bold'
          | 'thin'
          | 'light'
          | 'normal'
          | 'medium'
          | 'semibold'
          | 'extrabold'
          | null
          | undefined
        family?: 'heading' | 'default' | 'mono' | 'serif' | null | undefined
      } & import('class-variance-authority/types').ClassProp)
    | undefined,
) => string
declare function Text({
  className,
  size,
  color,
  weight,
  family,
  asChild,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof textVariants> & {
    asChild?: boolean
  }): import('react/jsx-runtime').JSX.Element
declare const SizableText: typeof Text
export {SizableText, Text, textVariants}
export type SizableTextProps = React.ComponentProps<typeof SizableText>
export type TextProps = React.ComponentProps<typeof Text>
