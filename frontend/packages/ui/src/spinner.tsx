import {cn} from './utils'
import * as React from 'react'

export type SpinnerProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: 'small' | 'large'
  color?: string
  hide?: boolean
}

// Rendered as a <span> (not <div>) so it stays valid phrasing content — it is
// frequently placed inside <p>/<a> (e.g. the document-header author link), where
// a <div> triggers `validateDOMNesting` warnings and force-closes the <p>.
export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  ({size = 'small', color, hide = false, className, ...props}, ref) => {
    const sizeClasses = {
      small: 'size-4 border-2',
      large: 'size-8 border-4',
    }

    return (
      <span
        ref={ref}
        className={cn(
          'inline-block animate-spin rounded-full border-solid border-current border-r-transparent',
          'transition-opacity duration-300',
          hide ? 'opacity-0' : 'opacity-100',
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
