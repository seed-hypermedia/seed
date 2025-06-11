import {Slot} from '@radix-ui/react-slot'
import {cva, type VariantProps} from 'class-variance-authority'
import * as React from 'react'
import {cn} from '../utils'

/**
 * Migration Guide from Tamagui Text/SizableText to new Text component:
 *
 * OLD Tamagui API → NEW API:
 * - size="$1" → size="xs"
 * - size="$2" → size="sm"
 * - size="$3" → size="md"
 * - size="$4" → size="lg"
 * - size="$5" → size="xl"
 * - size="$6" → size="2xl"
 * - size="$7" → size="3xl"
 *
 * - color="$color9" → color="muted"
 * - color="$color8" → color="muted"
 * - color="$brand5" → color="brand"
 * - color="$red10" → color="danger"
 * - color="$yellow10" → color="warning"
 *
 * - fontWeight="600" → weight="semibold"
 * - fontWeight="700" → weight="bold"
 * - fontWeight="800" → weight="extrabold"
 * - fontWeight="bold" → weight="bold"
 *
 * For custom styles like textOverflow, whiteSpace, etc., use className:
 * - textOverflow="ellipsis" → className="truncate"
 * - whiteSpace="nowrap" → className="whitespace-nowrap"
 * - userSelect="none" → className="select-none"
 * - flexShrink={0} → className="shrink-0"
 * - display="block" → className="block"
 */

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
        danger: 'text-destructive',
        warning: 'text-yellow-600 dark:text-yellow-400',
        success: 'text-green-600 dark:text-green-400',
        muted: 'text-muted-foreground',
      },
      weight: {
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
