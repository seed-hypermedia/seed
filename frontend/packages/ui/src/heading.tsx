import {cva, type VariantProps} from 'class-variance-authority'
import {forwardRef} from 'react'
import {cn} from './utils'

const headingVariants = cva('font-bold text-gray-900 dark:text-gray-100', {
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
})

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
