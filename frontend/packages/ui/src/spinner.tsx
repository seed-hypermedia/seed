// forked from tamagui because we cant import directly from tamagui package on web/remix

import {cn} from '@shm/ui/utils'
import * as React from 'react'

export type SpinnerProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: 'small' | 'large'
  color?: string
}

export const Spinner = React.forwardRef<HTMLDivElement, SpinnerProps>(
  ({size = 'small', color, className, ...props}, ref) => {
    const sizeClasses = {
      small: 'w-4 h-4 border-2',
      large: 'w-8 h-8 border-4',
    }

    return (
      <div
        ref={ref}
        className={cn(
          'inline-block animate-spin rounded-full border-solid border-current border-r-transparent',
          sizeClasses[size],
          className,
        )}
        style={{
          color: color || 'currentColor',
          ...props.style,
        }}
        {...props}
      />
    )
  },
)

Spinner.displayName = 'Spinner'
