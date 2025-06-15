import {cva, type VariantProps} from 'class-variance-authority'
import {forwardRef} from 'react'
import {cn} from './utils'

export const headingVariants = cva(
  'font-bold text-gray-900 dark:text-gray-100',
  {
    variants: {
      level: {
        1: 'text-2xl leading-9 md:text-3xl md:leading-10',
        2: 'text-xl leading-8 md:text-2xl md:leading-9 ',
        3: 'text-lg leading-7 md:text-xl md:leading-8',
        4: 'text-base leading-6 md:text-lg md:leading-7',
      },
    },
    defaultVariants: {
      level: 2,
    },
  },
)

export const marginClasses = {
  1: 'mt-8 md:mt-10 lg:mt-12', // Largest margin for h1
  2: 'mt-6 md:mt-8 lg:mt-10', // Medium margin for h2
  3: 'mt-4 md:mt-6 lg:mt-8', // Smaller margin for h3
  default: 'mt-6 md:mt-8 lg:mt-10', // Default margin for other headings
}

export interface SeedHeadingProps
  extends React.HTMLAttributes<HTMLHeadingElement>,
    VariantProps<typeof headingVariants> {
  asChild?: boolean
}

export const SeedHeading = forwardRef<HTMLHeadingElement, SeedHeadingProps>(
  ({className, level, asChild = false, ...props}, ref) => {
    const Tag =
      level === 1
        ? 'h2'
        : level === 2
        ? 'h3'
        : level === 3
        ? 'h4'
        : level === 4
        ? 'h5'
        : 'h3'

    return (
      <Tag
        ref={ref}
        className={cn(headingVariants({level}), className)}
        {...props}
      />
    )
  },
)

SeedHeading.displayName = 'SeedHeading'
