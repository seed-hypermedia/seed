import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {cn} from '../utils'

const textVariants = cva(
  'leading-normal', // Base styles
  {
    variants: {
      size: {
        xs: 'text-xs', // 12px
        sm: 'text-sm', // 14px
        md: 'text-base', // 16px
        lg: 'text-lg', // 18px
        xl: 'text-xl', // 20px
        '2xl': 'text-2xl', // 24px
        '3xl': 'text-3xl', // 30px
        '4xl': 'text-4xl', // 40px
        '5xl': 'text-5xl', // 50px
      },
      color: {
        default: 'text-foreground',
        brand: 'text-brand',
        'brand-12': 'text-brand-12',
        destructive: 'text-destructive',
        warning: 'text-yellow-600 dark:text-yellow-400',
        success: 'text-green-600 dark:text-green-400',
        muted: 'text-muted-foreground',
      },
      weight: {
        thin: 'font-thin',
        light: 'font-light',
        normal: 'font-normal',
        medium: 'font-medium',
        semibold: 'font-semibold',
        bold: 'font-bold',
        extrabold: 'font-extrabold',
      },
      family: {
        default: 'font-sans',
        mono: 'font-mono',
        heading: 'font-heading',
        serif: 'font-serif',
      },
    },
  },
)

function Text({
  className,
  size,
  color,
  weight,
  family,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> &
  VariantProps<typeof textVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'span'

  return (
    <Comp
      className={cn(textVariants({size, color, weight, family, className}))}
      {...props}
    />
  )
}

// SizableText is just an alias for Text for backward compatibility during migration
const SizableText = Text

export {SizableText, Text, textVariants}

export type SizableTextProps = React.ComponentProps<typeof SizableText>
export type TextProps = React.ComponentProps<typeof Text>
